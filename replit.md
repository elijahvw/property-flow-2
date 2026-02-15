# PropertyFlow — Property Management Platform

## Overview
Multi-tenant property management platform built with a monorepo architecture. Designed for AWS deployment via GitHub Actions, with local development served through Replit.

## Project Architecture


### Monorepo Structure
```
client/          - React + Vite frontend (port 5000)
server/          - Fastify + TypeScript API (port 3001)
shared/          - Shared types, schemas, constants
start.sh         - Automated dev startup script
```

### Tech Stack
- **Frontend**: React 18, Vite 5, TypeScript
- **Backend**: Fastify 4, TypeScript, Prisma ORM
- **Database**: PostgreSQL (Replit built-in / RDS in prod)
- **Shared**: Zod schemas, TypeScript types

### Key Design Decisions
- Multi-tenant: every DB table scoped by `company_id`
- RBAC: roles (PLATFORM_ADMIN, COMPANY_OWNER, PROPERTY_MANAGER, MAINTENANCE, TENANT) stored in DB
- Modular server: feature modules under `server/src/modules/`
- Frontend proxies `/api` requests to backend on port 3001

### Database Schema (Prisma)
Core tables: companies, users, company_users, properties, units, tenants, leases, lease_tenants, charges, maintenance_requests, work_orders, ledger_entries

### API Endpoints
- `GET /api/health` — health check
- `GET /api/version` — version info
- `GET/POST /api/companies` — company CRUD
- `GET/POST /api/properties` — property CRUD
- `POST /api/properties/:id/units` — create unit
- `GET /api/properties/:id/units` — list units

### Running Locally
The `start.sh` script handles everything automatically:
1. Installs dependencies (npm) for root, server, and client
2. Generates Prisma client and pushes schema
3. Starts Fastify server on port 3001
4. Starts Vite dev server on port 5000

### Production Deployment
Designed for AWS deployment via GitHub Actions (see PRD for full pipeline details).

## Recent Changes
- Initial project setup (Feb 2026)
- Monorepo structure with client/server/shared
- Full Prisma schema with all core tables
- Health, version, company, and property API endpoints
- React frontend with system status dashboard
