import fastify from 'fastify';
import cors from '@fastify/cors';
import auth0 from 'fastify-auth0-verify';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const server = fastify({ logger: true });

server.register(cors, {
  origin: '*', // In production, restrict this
});

// Health check endpoint for ALB
server.get('/', async () => {
  return { status: 'ok', version: '1.0.0' };
});

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || '';
const AUTH0_CLIENT_ID = process.env.AUTH0_MANAGEMENT_CLIENT_ID || '';
const AUTH0_CLIENT_SECRET = process.env.AUTH0_MANAGEMENT_CLIENT_SECRET || '';
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || '';

if (!AUTH0_DOMAIN || !AUTH0_AUDIENCE) {
  server.log.warn('Missing AUTH0_DOMAIN or AUTH0_AUDIENCE in environment variables');
}

server.register(auth0 as any, {
  domain: AUTH0_DOMAIN,
  audience: AUTH0_AUDIENCE,
});

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

  managementToken = (response.data as any).access_token;
  // Reset token after 1 hour (tokens usually last 24h)
  setTimeout(() => { managementToken = null; }, 3600000);
  return managementToken;
}

// GET all users
server.get('/api/users', { preValidation: [server.authenticate] }, async (request: any, reply) => {
  // Only allow admins
  const roles = request.user['https://propertyflow.com/roles'] || [];
  if (!roles.includes('admin')) {
    return reply.status(403).send({ error: 'Forbidden' });
  }

  try {
    const token = await getManagementToken();
    const response = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    // For each user, we also need their roles
    const usersWithRoles = await Promise.all((response.data as any[]).map(async (user: any) => {
      const rolesResponse = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/users/${user.user_id}/roles`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return {
        id: user.user_id,
        email: user.email,
        name: user.name || user.email,
        role: (rolesResponse.data as any[])[0]?.name || 'tenant'
      };
    }));

    return usersWithRoles;
  } catch (error: any) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Failed to fetch users' });
  }
});

// UPDATE user role
server.post('/api/users/:id/role', { preValidation: [server.authenticate] }, async (request: any, reply) => {
  // Only allow admins
  const adminRoles = request.user['https://propertyflow.com/roles'] || [];
  if (!adminRoles.includes('admin')) {
    return reply.status(403).send({ error: 'Forbidden' });
  }

  const { id } = request.params;
  const { role } = request.body as any;
  
  try {
    const token = await getManagementToken();
    
    // 1. Get all roles to find the role ID
    const allRolesResponse = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/roles`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const newRole = (allRolesResponse.data as any[]).find((r: any) => r.name === role);
    if (!newRole) return reply.status(400).send({ error: 'Role not found' });

    // 2. Get current roles for the user and remove them
    const currentRolesResponse = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/users/${id}/roles`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const currentRoles = currentRolesResponse.data as any[];
    if (currentRoles.length > 0) {
      await axios.delete(`https://${AUTH0_DOMAIN}/api/v2/users/${id}/roles`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { roles: currentRoles.map((r: any) => r.id) }
      } as any);
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
