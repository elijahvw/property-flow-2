# PropertyFlow Development

## Commands

- **Build All**: `npm run build` (from root)
- **Build Server**: `npm run build --workspace=@property-flow/server`
- **Build Client**: `npm run build --workspace=@property-flow/client`
- **Build Shared**: `npm run build --workspace=@property-flow/shared`
- **Typecheck Server**: `cd server && npx tsc --noEmit`
- **Typecheck Client**: `cd client && npx tsc --noEmit`
- **Test Server**: `cd server && npm test` (using vitest)
- **Database Migration**: `cd server && npx prisma migrate dev`
- **Generate Prisma**: `cd server && npx prisma generate`

## Project Structure

- `client/`: React + Vite frontend
- `server/`: Fastify + Prisma backend
- `shared/`: Common TypeScript types and logic
- `infra/`: Terraform configurations for AWS

## Guidelines

- Follow existing naming conventions (camelCase for variables, PascalCase for components).
- Use `fetchWithAuth` in the client for authenticated API calls.
- Always include the `X-Company-ID` header for multi-tenant requests.
