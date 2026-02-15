export enum UserRole {
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
  COMPANY_OWNER = 'COMPANY_OWNER',
  PROPERTY_MANAGER = 'PROPERTY_MANAGER',
  MAINTENANCE = 'MAINTENANCE',
  TENANT = 'TENANT',
}

export interface HealthResponse {
  status: string;
  timestamp: string;
}

export interface VersionResponse {
  version: string;
  buildId: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Company {
  id: string;
  name: string;
}

export interface CompanyUser {
  userId: string;
  companyId: string;
  role: UserRole;
}

export interface Property {
  id: string;
  companyId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface Unit {
  id: string;
  companyId: string;
  propertyId: string;
  number: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  rentAmount: number;
}
