import fastify from 'fastify';
import cors from '@fastify/cors';
import auth0 from 'fastify-auth0-verify';
import axios from 'axios';
import dotenv from 'dotenv';
import { prisma } from './lib/prisma.js';

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    dbUser?: any;
  }
}

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

// Authenticated routes - move definitions out for better scope visibility
const authenticate = (instance: any) => (request: any, reply: any, done: any) => {
  const authPlugin = (instance.authenticate || server.authenticate);
  if (typeof authPlugin === 'function') {
    return authPlugin(request, reply, done);
  }
  instance.log.error('Authentication plugin not found on instance or server');
  reply.status(500).send({ error: 'Authentication service unavailable' });
};

// Middleware to ensure user is synced with DB and check company access
const withUserSync = async (request: any, reply: any) => {
  if (!request.user) {
    return reply.status(401).send({ error: 'Unauthorized: No user in request' });
  }
  
  const auth0User = request.user;
  const roles = auth0User['https://propertyflow.com/roles'] || [];
  
  try {
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
  } catch (error: any) {
    server.log.error('User Sync Error:', error.message);
    return reply.status(500).send({ error: 'Failed to sync user data' });
  }
};

// --- ROUTES ---

// GET current user profile
server.get('/api/me', { preValidation: [authenticate(server), withUserSync] }, async (request: any, reply) => {
  return request.dbUser;
});

// GET all companies (Admin only)
server.get('/api/companies', { preValidation: [authenticate(server), withUserSync] }, async (request: any, reply) => {
  if (request.dbUser.role !== 'admin') {
    return reply.status(403).send({ error: 'Forbidden' });
  }
  return prisma.company.findMany({
    include: { _count: { select: { users: true, properties: true } } }
  });
});

// CREATE company (Admin only)
server.post('/api/companies', { preValidation: [authenticate(server), withUserSync] }, async (request: any, reply) => {
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

// GET all users
server.get('/api/users', { preValidation: [authenticate(server), withUserSync] }, async (request: any, reply) => {
  // Only allow admins
  if (request.dbUser.role !== 'admin') {
    return reply.status(403).send({ error: 'Forbidden' });
  }
  
  const companyId = request.headers['x-company-id'] as string;
  
  try {
    const token = await getManagementToken();
    const response = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const allUsers = response.data as any[];
    const localUsers = await prisma.user.findMany({
      include: { company: true }
    });

    const usersWithRoles = await Promise.all(allUsers.map(async (user: any) => {
      const localUser = localUsers.find((u: any) => u.id === user.user_id);
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

    return (usersWithRoles as any[]).filter((u: any) => u !== null);
  } catch (error: any) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Failed to fetch users' });
  }
});

// GET all properties (scoped by company)
server.get('/api/properties', { preValidation: [authenticate(server), withUserSync] }, async (request: any, reply) => {
  const companyId = request.headers['x-company-id'] as string;
  if (!companyId) return reply.status(400).send({ error: 'X-Company-ID header is required' });

  return prisma.property.findMany({
    where: { companyId }
  });
});

// CREATE property
server.post('/api/properties', { preValidation: [authenticate(server), withUserSync] }, async (request: any, reply) => {
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

// CREATE user in Auth0
server.post('/api/users', { preValidation: [authenticate(server)] }, async (request: any, reply) => {
  const adminRoles = request.user['https://propertyflow.com/roles'] || [];
  if (!adminRoles.includes('admin')) {
    return reply.status(403).send({ error: 'Forbidden' });
  }

  const { email, password, name, role } = request.body as any;
  try {
    const token = await getManagementToken();
    const createResponse = await axios.post(`https://${AUTH0_DOMAIN}/api/v2/users`, {
      email,
      password,
      name,
      connection: 'Username-Password-Authentication',
      email_verified: true
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const userId = createResponse.data.user_id;
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
    }

    return createResponse.data;
  } catch (error: any) {
    server.log.error(error.response?.data || error.message);
    return reply.status(error.response?.status || 500).send({ 
      error: 'Failed to create user', 
      details: error.response?.data?.message || error.message 
    });
  }
});

// BLOCK/UNBLOCK user
server.route({
  method: ['POST', 'PATCH'],
  url: '/api/users/:id/status',
  preValidation: [authenticate(server)],
  handler: async (request: any, reply) => {
    const adminRoles = request.user['https://propertyflow.com/roles'] || [];
    if (!adminRoles.includes('admin')) return reply.status(403).send({ error: 'Forbidden' });
    const { id } = request.params as any;
    const { blocked } = request.body as any;
    try {
      const token = await getManagementToken();
      const response = await axios.patch(`https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(id)}`, { blocked }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data;
    } catch (error: any) {
      return reply.status(500).send({ error: 'Failed to update status' });
    }
  }
});

// UPDATE user role
server.post('/api/users/:id/role', { preValidation: [authenticate(server)] }, async (request: any, reply) => {
  const adminRoles = request.user['https://propertyflow.com/roles'] || [];
  if (!adminRoles.includes('admin')) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const { role } = request.body as any;
  try {
    const token = await getManagementToken();
    const allRolesResponse = await axios.get(`https://${AUTH0_DOMAIN}/api/v2/roles`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const newRole = (allRolesResponse.data as any[]).find((r: any) => r.name === role);
    if (!newRole) return reply.status(400).send({ error: 'Role not found' });

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
    await axios.post(`https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(id)}/roles`, {
      roles: [newRole.id]
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return { success: true };
  } catch (error: any) {
    return reply.status(500).send({ error: 'Failed to update role' });
  }
});

// UPDATE user (name, email)
server.patch('/api/users/:id', { preValidation: [authenticate(server)] }, async (request: any, reply) => {
  const adminRoles = request.user['https://propertyflow.com/roles'] || [];
  if (!adminRoles.includes('admin')) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const updateData = request.body as any;
  try {
    const token = await getManagementToken();
    const response = await axios.patch(`https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(id)}`, updateData, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
  } catch (error: any) {
    return reply.status(500).send({ error: 'Failed to update user' });
  }
});

// Catch-all for /api/users/* (ID encoding issues)
server.all('/api/users/*', async (request, reply) => {
  return reply.status(404).send({ 
    error: 'Not Found', 
    message: `Route ${request.method}:${request.url} not found`,
    suggestion: 'Check if the user ID is correctly encoded'
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
