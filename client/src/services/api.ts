import { AuthService } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || '';
console.log('API_BASE initialized as:', API_BASE);

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

const handleResponse = async (res: Response) => {
  if (!res.ok) {
    let errorMsg = `Server responded with ${res.status}`;
    try {
      const errorData = await res.json();
      errorMsg = errorData.error || errorData.message || errorMsg;
    } catch (e) {
      // Not JSON, use default
    }
    throw new Error(errorMsg);
  }
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Expected JSON but got ${contentType || 'nothing'} (first 50 chars: ${text.substring(0, 50)})`);
  }
  return res.json();
};

export const CompanyService = {
  create: (name: string) => fetchWithAuth('/api/companies', {
    method: 'POST',
    body: JSON.stringify({ name })
  }).then(handleResponse),
};

export const PropertyService = {
  list: () => fetchWithAuth('/api/properties').then(handleResponse),
  create: (data: any) => fetchWithAuth('/api/properties', {
    method: 'POST',
    body: JSON.stringify(data)
  }).then(handleResponse),
  getUnits: (propertyId: string) => fetchWithAuth(`/api/properties/${propertyId}/units`).then(handleResponse),
  createUnit: (propertyId: string, data: any) => fetchWithAuth(`/api/properties/${propertyId}/units`, {
    method: 'POST',
    body: JSON.stringify(data)
  }).then(handleResponse),
};
