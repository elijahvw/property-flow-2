import fastify from 'fastify';
import cors from '@fastify/cors';
import auth0 from 'fastify-auth0-verify';
import axios from 'axios';
import dotenv from 'dotenv';
import { prisma } from './lib/prisma';

dotenv.config();

const server = fastify({ logger: true });

server.register(cors, {
  origin: '*', // In production, restrict this
});

// Health check endpoint for ALB (registered BEFORE auth)
server.get('/', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || '';
const AUTH0_CLIENT_ID = process.env.AUTH0_MANAGEMENT_CLIENT_ID || '';
const AUTH0_CLIENT_SECRET = process.env.AUTH0_MANAGEMENT_CLIENT_SECRET || '';
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || process.env.VITE_AUTH0_AUDIENCE || '';

console.log('--- Starting Server Configuration ---');
console.log('AUTH0_DOMAIN:', AUTH0_DOMAIN ? 'SET' : 'MISSING');
console.log('AUTH0_AUDIENCE:', AUTH0_AUDIENCE ? 'SET' : 'MISSING');
console.log('AUTH0_MANAGEMENT_CLIENT_ID:', AUTH0_CLIENT_ID ? 'SET' : 'MISSING');

if (AUTH0_DOMAIN && AUTH0_AUDIENCE) {
  server.register(auth0 as any, {
    domain: AUTH0_DOMAIN,
    audience: AUTH0_AUDIENCE,
  });
} else {
  server.log.error('CRITICAL: AUTH0_DOMAIN or AUTH0_AUDIENCE not set. Auth routes will fail.');
}

let managementToken: string | null = null;

// Helper to get Auth0 Management API Token
async function getManagementToken() {
  if (managementToken) return managementToken;

  const params = new URLSearchParams();
  params.append('client_id', AUTH0_CLIENT_ID);
  params.append('client_secret', AUTH0_CLIENT_SECRET);
  params.append('audience', `https://${AUTH0_DOMAIN}/api/v2/`);
  params.append('grant_type', 'client_credentials');

  try {
    const response = await axios.post(`https://${AUTH0_DOMAIN}/oauth/token`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    managementToken = (response.data as any).access_token;
    // Reset token after 1 hour (tokens usually last 24h)
    setTimeout(() => { managementToken = null; }, 3600000);
    return managementToken;
  } catch (error: any) {
    console.error('ERROR: Failed to get Auth0 Management token');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data));
    } else {
      console.error('Message:', error.message);
    }
    throw error;
  }
}

// Authenticated routes
server.register(async (instance) => {
  // Safe authentication hook that won't crash if plugin fails to load
  const authenticate = (request: any, reply: any, done: any) => {
    if (typeof (instance as any).authenticate === 'function') {
      return (instance as any).authenticate(request, reply, done);
    }
    reply.status(500).send({ error: 'Authentication service unavailable' });
  };

  // Middleware to ensure user is synced with DB and check company access
  const withUserSync = async (request: any, reply: any) => {
    const auth0User = request.user;
    const roles = auth0User['https://propertyflow.com/roles'] || [];
    
    // Sync user with Prisma
    let user = await prisma.user.upsert({
      where: { id: auth0User.sub },
      update: {
        email: auth0User.email,
        name: auth0User.name,
        role: roles.includes('admin') ? 'admin' : (roles.includes('landlord') ? 'landlord' : 'tenant'),
      },
      create: {
        id: auth0User.sub,
        email: auth0User.email,
        name: auth0User.name,
        role: roles.includes('admin') ? 'admin' : (roles.includes('landlord') ? 'landlord' : 'tenant'),
      },
    });

    request.dbUser = user;

    // Multi-tenant check: if X-Company-ID is provided, verify access
    const companyId = request.headers['x-company-id'] as string;
    if (companyId) {
      if (user.role !== 'admin' && user.companyId !== companyId) {
        return reply.status(403).send({ error: 'Forbidden: You do not belong to this company' });
      }
    }
  };

  // --- COMPANY ROUTES ---

  // GET all companies (Admin only)
  instance.get('/api/companies', { preValidation: [authenticate, withUserSync] }, async (request: any, reply) => {
    if (request.dbUser.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    return prisma.company.findMany({
      include: { _count: { select: { users: true, properties: true } } }
    });
  });

  // CREATE company (Admin only)
  instance.post('/api/companies', { preValidation: [authenticate, withUserSync] }, async (request: any, reply) => {
    if (request.dbUser.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const { name, domain } = request.body as any;
    try {
      return await prisma.company.create({
        data: { name, domain }
      });
    } catch (error: any) {
      return reply.status(400).send({ error: 'Failed to create company', details: error.message });
    }
  });

  // ASSIGN user to company (Admin only)
  instance.post('/api/companies/:companyId/users/:userId', { preValidation: [authenticate, withUserSync] }, async (request: any, reply) => {
    if (request.dbUser.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const { companyId, userId } = request.params as any;
    try {
      return await prisma.user.update({
        where: { id: decodeURIComponent(userId) },
        data: { companyId }
      });
    } catch (error: any) {
      return reply.status(400).send({ error: 'Failed to assign user', details: error.message });
    }
  });

  // GET all users
  instance.get('/api/users', { preValidation: [authenticate, withUserSync] }, async (request: any, reply) => {
    // Only allow admins
    if (request.dbUser.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    
    // If we have a company filter, only show users for that company
    const companyId = request.headers['x-company-id'] as string;
    
    try {
      const token = await getManagementToken();
      const response = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const allUsers = response.data as any[];
      
      // Get all local users with their company associations
      const localUsers = await prisma.user.findMany({
        include: { company: true }
      });

      const usersWithRoles = await Promise.all(allUsers.map(async (user: any) => {
        const localUser = localUsers.find(u => u.id === user.user_id);
        
        // Filter by company if requested
        if (companyId && localUser?.companyId !== companyId) return null;

        const rolesResponse = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(user.user_id)}/roles`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        return {
          id: user.user_id,
          email: user.email,
          name: user.name || user.email,
          role: (rolesResponse.data as any[])[0]?.name || 'tenant',
          blocked: user.blocked || false,
          company: localUser?.company || null
        };
      }));

      return usersWithRoles.filter(u => u !== null);
    } catch (error: any) {
      instance.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch users' });
    }
  });

  // --- PROPERTY ROUTES ---

  // GET all properties (scoped by company)
  instance.get('/api/properties', { preValidation: [authenticate, withUserSync] }, async (request: any, reply) => {
    const companyId = request.headers['x-company-id'] as string;
    if (!companyId) return reply.status(400).send({ error: 'X-Company-ID header is required' });

    return prisma.property.findMany({
      where: { companyId }
    });
  });

  // CREATE property
  instance.post('/api/properties', { preValidation: [authenticate, withUserSync] }, async (request: any, reply) => {
    const companyId = request.headers['x-company-id'] as string;
    if (!companyId) return reply.status(400).send({ error: 'X-Company-ID header is required' });

    const { name, address, city, state, zip } = request.body as any;
    try {
      return await prisma.property.create({
        data: { name, address, city, state, zip, companyId }
      });
    } catch (error: any) {
      return reply.status(400).send({ error: 'Failed to create property', details: error.message });
    }
  });

  // CREATE user
  instance.post('/api/users', { preValidation: [authenticate] }, async (request: any, reply) => {
    const adminRoles = request.user['https://propertyflow.com/roles'] || [];
    if (!adminRoles.includes('admin')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { email, password, name, role } = request.body as any;
    instance.log.info(`Creating user: ${email}, role: ${role}`);

    try {
      const token = await getManagementToken();
      
      // 1. Create the user
      instance.log.info('Step 1: Creating user in Auth0...');
      let createResponse;
      try {
        createResponse = await axios.post(`https://${AUTH0_DOMAIN}/api/v2/users`, {
          email,
          password,
          name,
          connection: 'Username-Password-Authentication', // Default Auth0 connection
          email_verified: true
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch (createError: any) {
        instance.log.error('Auth0 User Creation Error:', createError.response?.data || createError.message);
        throw createError;
      }

      const userId = createResponse.data.user_id;
      instance.log.info(`User created successfully: ${userId}`);

      // 2. Assign role
      instance.log.info(`Step 2: Assigning role '${role}' to user ${userId}...`);
      try {
        const allRolesResponse = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/roles`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        const newRole = (allRolesResponse.data as any[]).find((r: any) => r.name === (role || 'tenant'));
        if (newRole) {
          await axios.post(`https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}/roles`, {
            roles: [newRole.id]
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
          instance.log.info('Role assigned successfully');
        } else {
          instance.log.warn(`Role '${role}' not found in Auth0, skipping assignment`);
        }
      } catch (roleError: any) {
        instance.log.error('Auth0 Role Assignment Error:', roleError.response?.data || roleError.message);
        // We don't necessarily want to fail the whole request if role assignment fails, 
        // but for now let's keep it strict or at least return a partial success.
        throw roleError;
      }

      return createResponse.data;
    } catch (error: any) {
      instance.log.error('Detailed Create User Error:', error.response?.data || error.message);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      const errorCode = error.response?.data?.errorCode || 'internal_error';
      return reply.status(error.response?.status || 500).send({ 
        error: 'Failed to create user', 
        details: errorMessage,
        errorCode: errorCode,
        auth0Details: error.response?.data
      });
    }
  });

  // BLOCK/UNBLOCK user
  instance.post('/api/users/:id/status', { preValidation: [authenticate] }, async (request: any, reply) => {
    const adminRoles = request.user['https://propertyflow.com/roles'] || [];
    if (!adminRoles.includes('admin')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as any;
    const { blocked } = request.body as any;
    instance.log.info(`Toggling status for user ${id} to blocked=${blocked}`);

    try {
      const token = await getManagementToken();
      const response = await axios.patch(`https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(id)}`, { blocked }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data;
    } catch (error: any) {
      instance.log.error(error);
      return reply.status(500).send({ error: 'Failed to update status' });
    }
  });

  // UPDATE user role
  instance.post('/api/users/:id/role', { preValidation: [authenticate] }, async (request: any, reply) => {
    // Only allow admins
    const adminRoles = request.user['https://propertyflow.com/roles'] || [];
    if (!adminRoles.includes('admin')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as any;
    const { role } = request.body as any;
    instance.log.info(`Updating role for user ${id} to ${role}`);
    
    try {
      const token = await getManagementToken();
      
      // 1. Get all roles to find the role ID
      const allRolesResponse = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/roles`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const newRole = (allRolesResponse.data as any[]).find((r: any) => r.name === role);
      if (!newRole) return reply.status(400).send({ error: 'Role not found' });

      // 2. Get current roles for the user and remove them
      const currentRolesResponse = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(id)}/roles`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const currentRoles = currentRolesResponse.data as any[];
      if (currentRoles.length > 0) {
        await axios.delete(`https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(id)}/roles`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { roles: currentRoles.map((r: any) => r.id) }
        } as any);
      }

      // 3. Assign new role
      await axios.post(`https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(id)}/roles`, {
        roles: [newRole.id]
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      return { success: true };
    } catch (error: any) {
      instance.log.error(error);
      return reply.status(500).send({ error: 'Failed to update role' });
    }
  });

  // UPDATE user (name, email)
  instance.patch('/api/users/:id', { preValidation: [authenticate] }, async (request: any, reply) => {
    const adminRoles = request.user['https://propertyflow.com/roles'] || [];
    if (!adminRoles.includes('admin')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as any;
    const updateData = request.body as any;
    instance.log.info(`Updating user ${id} with ${JSON.stringify(updateData)}`);

    try {
      const token = await getManagementToken();
      const response = await axios.patch(`https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(id)}`, updateData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data;
    } catch (error: any) {
      instance.log.error(error);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      return reply.status(500).send({ error: 'Failed to update user', details: errorMessage });
    }
  });

  // Catch-all for /api/users/* to debug 404s
  instance.all('/api/users/*', async (request, reply) => {
    instance.log.warn(`Unmatched request: ${request.method} ${request.url}`);
    return reply.status(404).send({ 
      error: 'Not Found', 
      message: `Route ${request.method}:${request.url} not found`,
      suggestion: 'Check if the ID is correctly encoded'
    });
  });
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
