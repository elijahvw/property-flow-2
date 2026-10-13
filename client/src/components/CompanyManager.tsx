import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { startOperation } from '../operations';
import { useAuth0 } from '@auth0/auth0-react';

interface CompanyDetails {
  id: string;
  name: string;
  domain: string | null;
  users: { id: string; name: string | null; email: string; role: string }[];
  properties: { id: string; name: string; address: string; city: string; state: string; zip: string }[];
}

export default function CompanyManager({ companyId, onClose, onSaved, onManageUsers }: {
  companyId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onManageUsers: () => void;
}) {
  const { getAccessTokenSilently } = useAuth0();
  const [company, setCompany] = useState<CompanyDetails | null>(null);
  const [form, setForm] = useState({ name: '', domain: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const operation = startOperation('company.details.load');
    setLoading(true);
    setError(null);
    setCompany(null);
    (async () => {
      try {
        const token = await getAccessTokenSilently({ timeoutInSeconds: 8 });
        const response = await axios.get<CompanyDetails>(`/api/companies/${encodeURIComponent(companyId)}`, {
          headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
        });
        if (!active) return;
        operation.succeed();
        setCompany(response.data);
        setForm({ name: response.data.name, domain: response.data.domain || '' });
      } catch (err: any) {
        operation.fail(err);
        if (active) setError(err.response?.data?.error || 'Unable to load company details. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; operation.abandon(); };
  }, [companyId, getAccessTokenSilently, reload]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !company) return;
    const operation = startOperation('company.update');
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const token = await getAccessTokenSilently({ timeoutInSeconds: 8 });
      const response = await axios.patch(`/api/companies/${encodeURIComponent(companyId)}`, {
        name: form.name.trim(), domain: form.domain.trim() || null,
      }, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
      setCompany(previous => previous ? { ...previous, name: response.data.name, domain: response.data.domain } : previous);
      operation.succeed();
      setNotice('Company saved.');
      await onSaved();
    } catch (err: any) {
      operation.fail(err);
      setError(err.response?.data?.error || 'Unable to save company. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="company-manager-title"
        style={{ maxWidth: '760px', maxHeight: '85vh', overflowY: 'auto' }}>
        <h2 id="company-manager-title">Manage Company{company ? `: ${company.name}` : ''}</h2>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {loading ? <p role="status">Loading company details…</p> : company ? (
          <>
            <form onSubmit={save}>
              <div className="form-group">
                <label htmlFor="managed-company-name">Company Name</label>
                <input id="managed-company-name" value={form.name} maxLength={200} required disabled={saving}
                  onChange={event => setForm({ ...form, name: event.target.value })} />
              </div>
              <div className="form-group">
                <label htmlFor="managed-company-domain">Custom Domain (Optional)</label>
                <input id="managed-company-domain" value={form.domain} maxLength={253} disabled={saving}
                  placeholder="e.g. acme-rentals.com"
                  onChange={event => setForm({ ...form, domain: event.target.value })} />
                <p className="text-muted">Saving a domain records it here. Domain routing still requires setup.</p>
              </div>
              <button className="btn-primary" type="submit" disabled={saving || !form.name.trim()}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </form>
            <h3>Assigned Users ({company.users.length})</h3>
            {company.users.length ? (
              <ul>{company.users.map(user => <li key={user.id}>{user.name || user.email} — {user.email} ({user.role})</li>)}</ul>
            ) : <p>No users assigned to this company.</p>}
            <button className="btn-secondary" onClick={onManageUsers} disabled={saving}>Manage User Assignments</button>
            <h3>Properties ({company.properties.length})</h3>
            {company.properties.length ? (
              <ul>{company.properties.map(property => <li key={property.id}>{property.name} — {property.address}, {property.city}, {property.state} {property.zip}</li>)}</ul>
            ) : <p>No properties assigned to this company.</p>}
          </>
        ) : <button className="btn-secondary" onClick={() => setReload(value => value + 1)}>Retry</button>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
