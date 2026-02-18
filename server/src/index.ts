import fastify from 'fastify';
import cors from '@fastify/cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const server = fastify({ logger: true });

server.register(cors, {
  origin: '*', // In production, restrict this
});

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_CLIENT_ID = process.env.AUTH0_MANAGEMENT_CLIENT_ID;
const AUTH0_CLIENT_SECRET = process.env.AUTH0_MANAGEMENT_CLIENT_SECRET;

let managementToken: string | null = null;

// Helper to get Auth0 Management API Token
async function getManagementToken() {
  if (managementToken) return managementToken;

  const response = await axios.post(`https://${AUTH0_DOMAIN}/oauth/token`, {
    client_id: AUTH0_CLIENT_ID,
    client_secret: AUTH0_CLIENT_SECRET,
    audience: `https://${AUTH0_DOMAIN}/api/v2/`,
    grant_type: 'client_credentials',
  });

  managementToken = response.data.access_token;
  // Reset token after 1 hour (tokens usually last 24h)
  setTimeout(() => { managementToken = null; }, 3600000);
  return managementToken;
}

// GET all users
server.get('/users', async (request, reply) => {
  try {
    const token = await getManagementToken();
    const response = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    // For each user, we also need their roles
    const usersWithRoles = await Promise.all(response.data.map(async (user: any) => {
      const rolesResponse = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/users/${user.user_id}/roles`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return {
        id: user.user_id,
        email: user.email,
        name: user.name,
        role: rolesResponse.data[0]?.name || 'tenant'
      };
    }));

    return usersWithRoles;
  } catch (error: any) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Failed to fetch users' });
  }
});

// UPDATE user role
server.post('/users/:id/role', async (request: any, reply) => {
  const { id } = request.params;
  const { role } = request.body;
  
  try {
    const token = await getManagementToken();
    
    // 1. Get all roles to find the role ID
    const allRolesResponse = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/roles`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const newRole = allRolesResponse.data.find((r: any) => r.name === role);
    if (!newRole) return reply.status(400).send({ error: 'Role not found' });

    // 2. Get current roles for the user and remove them
    const currentRolesResponse = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/users/${id}/roles`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (currentRolesResponse.data.length > 0) {
      await axios.delete(`https://${AUTH0_DOMAIN}/api/v2/users/${id}/roles`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { roles: currentRolesResponse.data.map((r: any) => r.id) }
      });
    }

    // 3. Assign new role
    await axios.post(`https://${AUTH0_DOMAIN}/api/v2/users/${id}/roles`, {
      roles: [newRole.id]
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return { success: true };
  } catch (error: any) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Failed to update role' });
  }
});

const start = async () => {
  try {
    await server.listen({ port: 5011, host: '0.0.0.0' });
    console.log('Server listening on port 5011');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
