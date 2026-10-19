import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState } from 'react';
import './PrivateDocuments.css';
import { api } from '../api';
import { useResource } from '../useResource';
import { formatActivityTime } from '../dates';
import { Form } from './Form';
import { EditorDialog, useEditorBusy } from './EditorDialog';
type Version={id:string;number:number;filename:string;byteLength:number;scanStatus:string;createdAt:string};
type Document={id:string;title:string;version:number;archivedAt:string|null;versions:Version[]};
const scanLabel=(status:string)=>status==='clean'?'Cleared by scanning':status==='rejected'?'Rejected by scanning. Download blocked.':'Quarantined. Download blocked until scanning clears this version.';
export function PrivateDocuments({source,sourceId}:{source:'leases'|'maintenance';sourceId:string}) {
  const [params]=useSearchParams(), focusedId=params.get("documentId"), focused=useRef<string|null>(null);
  const endpoint=`/api/company/${source}/${encodeURIComponent(sourceId)}/documents`;
  const r=useResource<{items:Document[];scanningConfigured?:boolean}>(endpoint,true,true), [notice,setNotice]=useState(''), [open,setOpen]=useState(false), [draft,setDraft]=useState<{document:Document|null;key:string}|null>(null);
  useEffect(()=>{if(!focusedId||!r.data?.items.some(doc=>doc.id===focusedId)||focused.current===focusedId)return;const node=window.document.getElementById(`private-document-${focusedId}`);if(node){focused.current=focusedId;node.focus();node.scrollIntoView({block:"start"});}},[focusedId,r.data]);
  const begin=(document:Document|null)=>{setDraft(current=>current||{document,key:crypto.randomUUID()});setOpen(true);};
  return <section className="panel private-documents">
    <div className="section-heading"><h2>Private documents</h2><button disabled={!r.data||!!r.error} onClick={()=>begin(null)}>Upload document</button></div>
    <p><Link to="/company/documents">Open document library →</Link></p>
    <p className="help">Management only. Uploads are quarantined until scanning clears them. Originals and earlier versions are retained. PDF, PNG, JPEG or text, up to 5 MB each.</p>
    {r.data&&<p className="help">{r.data.scanningConfigured?'Scanning is configured. Each upload is scanned automatically; only cleared files can be downloaded.':'Scanning is not configured. You can retain private originals, but downloads stay blocked until an administrator enables scanning.'}</p>}
    {notice&&<p role="status">{notice}</p>}
    {r.error&&<p role="alert">{r.error} <button onClick={r.reload}>Reload documents</button></p>}
    {focusedId&&r.data&&!r.data.items?.some(doc=>doc.id===focusedId)&&<p className="notice">This document is unavailable at this source. Review the retained documents below or return to the library.</p>}
    {!r.data?<p role="status">Loading documents…</p>:!(r.data.items||[]).length?<p>No documents uploaded for this record.</p>:<ul className="private-document-list">{r.data.items.map(doc=><li key={doc.id} id={`private-document-${doc.id}`} tabIndex={-1} className={doc.id===focusedId?"private-document-target":undefined}>
      <h3>{doc.title}{doc.archivedAt?' · Archived':''}</h3>
      {doc.versions[0]&&<p className="help">Latest version: {scanLabel(doc.versions[0].scanStatus)}</p>}
      <div className="actions">{!doc.archivedAt&&<button className="secondary" onClick={()=>begin(doc)}>Upload new version · {doc.title}</button>}
      <Form operation="document.archive" feedbackText={doc.archivedAt?"Document restored.":"Document archived; originals retained."} label={doc.archivedAt?'Restore document':'Archive document'} submit={async()=>{await api(`${endpoint}/${doc.id}`,{method:'PATCH',body:{expectedVersion:doc.version,archived:!doc.archivedAt}});r.reload();}}><p className="help">{doc.archivedAt?'Restore to allow new versions.':'Archiving keeps every original available to management.'}</p></Form></div>
      <details key={`${doc.id}:${doc.id===focusedId}`} open={doc.id===focusedId?true:undefined}><summary>{doc.versions.length} retained {doc.versions.length===1?'version':'versions'}</summary><ul className="private-version-list">{doc.versions.map((v,index)=><li key={v.id}>
        <strong>Version {v.number}{index===0?' · Latest uploaded':''}</strong><p>{v.filename} · {Math.ceil(v.byteLength/1024)} KB · {formatActivityTime(v.createdAt)}</p>
        <p>{scanLabel(v.scanStatus)}</p>
        {v.scanStatus==='pending'&&!doc.archivedAt&&<Form operation="document.scan" feedbackText="Scan finished. Review the recorded result." label="Scan file" submit={async()=>{await api(`${endpoint}/${doc.id}/versions/${v.id}/scan`,{method:'POST',body:{},timeoutMs:45000});r.reload();}}><span className="help">Scanning may take up to 30 seconds.</span></Form>}
        {v.scanStatus==='clean'&&<Form operation="document.download" feedbackText="Download prepared." label={`Download version ${v.number}`} submit={async()=>{
          const file=await api<{contentBase64:string;filename:string;mediaType:string}>(`${endpoint}/${doc.id}/versions/${v.id}/download`);
          const bytes=Uint8Array.from(atob(file.contentBase64),c=>c.charCodeAt(0)), url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})), link=document.createElement('a');
          link.href=url;link.download=file.filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }}><span className="help">Access is checked again for each download.</span></Form>}
      </li>)}</ul></details>
    </li>)}</ul>}
    {r.data&&draft&&<EditorDialog open={open} title={draft.document?'Upload new document version':'Upload private document'} onClose={()=>setOpen(false)} onDiscard={()=>{setDraft(null);setOpen(false);}}><DocumentUpload key={draft.key} endpoint={endpoint} scanningConfigured={!!r.data.scanningConfigured} draft={draft} saved={message=>{setNotice(message);setDraft(null);setOpen(false);r.reload();}} discard={()=>{setDraft(null);setOpen(false);}} /></EditorDialog>}
  </section>;
}
function DocumentUpload({endpoint,scanningConfigured,draft,saved,discard}:{endpoint:string;scanningConfigured:boolean;draft:{document:Document|null;key:string};saved:(message:string)=>void;discard:()=>void}) {
  const [file,setFile]=useState<File|null>(null);
  const { uncertain } = useEditorBusy();
  return <Form operation="document.upload" label={scanningConfigured?"Upload & scan":"Upload to quarantine"} feedbackText="Document uploaded privately. Scanning is required before download." submit={async data=>{
    if(!file||!file.size||file.size>5*1024*1024)throw new Error('Choose a file between 1 byte and 5 MB.');
    const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Unable to read this file. Choose it again.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
    const extension=file.name.split('.').pop()?.toLowerCase(), mediaType=file.type||({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain'} as Record<string,string>)[extension||''];
    const uploaded=await api<{documentId:string;versionId:string}>(endpoint,{method:'POST',timeoutMs:45000,body:{title:draft.document?.title||String(data.get('title')),filename:file.name,mediaType,contentBase64:base64,submissionKey:draft.key,...(draft.document?{documentId:draft.document.id,expectedVersion:draft.document.version}:{})}});
    let message='Document saved privately. Scanning is required before download.';
    if(scanningConfigured){
      try { const result=await api<{scanStatus:string}>(`${endpoint}/${uploaded.documentId}/versions/${uploaded.versionId}/scan`,{method:'POST',body:{},timeoutMs:45000});message=result.scanStatus==='clean'?'Document saved and cleared by scanning.':'Document saved. Scanning rejected this file; download is blocked.'; }
      catch { message='Document saved privately. Scanning did not finish; the file stays quarantined. Open its versions to retry scanning without uploading again.'; }
    }
    saved(message);
  }} secondaryActions={<button type="button" className="secondary" disabled={uncertain} onClick={discard}>Discard upload draft</button>}>
    {draft.document?<p>New version of <strong>{draft.document.title}</strong>. Previous originals remain retained.</p>:<label>Document title<input name="title" required maxLength={160}/></label>}
    <label>Document file<input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
    {file&&<p>Selected: {file.name} · {Math.ceil(file.size/1024)} KB</p>}
    <p>Uploaded only to this record. This does not share the file with residents or staff. Keep the same draft to retry a lost response safely.</p>
  </Form>;
}
