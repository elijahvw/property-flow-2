import { AuthService } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const token = await AuthService.getToken();
  const companyId = localStorage.getItem('active_company_id');
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(companyId ? { 'X-Company-ID': companyId } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  if (response.status === 401) {
    // Handle session expiry
    window.dispatchEvent(new CustomEvent('auth-failure'));
  }
  return response;
}

export const CompanyService = {
  create: (name: string) => fetchWithAuth('/api/companies', {
    method: 'POST',
    body: JSON.stringify({ name })
  }).then(res => res.json()),
};

export const PropertyService = {
  list: () => fetchWithAuth('/api/properties').then(res => res.json()),
  create: (data: any) => fetchWithAuth('/api/properties', {
    method: 'POST',
    body: JSON.stringify(data)
  }).then(res => res.json()),
  getUnits: (propertyId: string) => fetchWithAuth(`/api/properties/${propertyId}/units`).then(res => res.json()),
  createUnit: (propertyId: string, data: any) => fetchWithAuth(`/api/properties/${propertyId}/units`, {
    method: 'POST',
    body: JSON.stringify(data)
  }).then(res => res.json()),
};
