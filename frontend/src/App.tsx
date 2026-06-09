import { useState, useEffect } from 'react';

// API Configuration
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000/api/v1';

interface Attachment {
  id: string;
  attachment_id: string;
  filename: string;
  mime_type: string;
  file_size_bytes: number;
  extracted_text: string | null;
  image_data: string | null;  // base64 data URI for image preview
  processing_status: string;
  created_at: string;
}

interface Email {
  id: string;
  message_id: string;
  sender: string;
  recipient: string;
  subject: string;
  body?: string;
  received_at: string;
  processing_status: string;
  summary: string | null;
  attachment_count?: number;
  attachments?: Attachment[];
}

interface DashboardMetrics {
  total_emails_processed: number;
  failed_emails: number;
  success_rate_percentage: number;
  processing_by_mime: Record<string, number>;
  timeline: Array<{
    date: string;
    processed: number;
    failed: number;
  }>;
}

function parseTextToStructuredData(filename: string, mimeType: string, rawText: string) {
  const data = {
    metadata: {
      filename: filename,
      mime_type: mimeType,
      status: "success"
    },
    raw_text: rawText,
    structured_data: {
      invoice_number: null as string | null,
      invoice_date: null as string | null,
      total_amount: null as string | null,
      emails: [] as string[],
      dates: [] as string[],
      extracted_key_values: {} as Record<string, string>
    }
  };

  if (!rawText) return data;

  // Extract emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = Array.from(new Set(rawText.match(emailRegex) || []));
  data.structured_data.emails = emails.sort();

  // Extract dates (YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY)
  const dateRegex = /\b(?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}|\d{2}\/\d{2}\/\d{4})\b/g;
  const dates = Array.from(new Set(rawText.match(dateRegex) || []));
  data.structured_data.dates = dates.sort();

  // Extract key-value lines (e.g. Key: Value)
  const keyValues: Record<string, string> = {};
  const lines = rawText.split('\n');
  lines.forEach(line => {
    const match = line.match(/^\s*([A-Za-z0-9\s_&/\-+\(\)#@\.]+)\s*:\s*(.+)$/);
    if (match) {
      const k = match[1].trim();
      const v = match[2].trim();
      if (v && k.length < 50) {
        keyValues[k] = v;
      }
    }
  });
  data.structured_data.extracted_key_values = keyValues;

  // Map invoice fields
  for (const [k, v] of Object.entries(keyValues)) {
    const kLower = k.toLowerCase();
    if (kLower.includes('invoice number') || kLower.includes('invoice no') || kLower.includes('inv no')) {
      data.structured_data.invoice_number = v;
    } else if (kLower.includes('invoice date') || kLower.includes('bill date') || kLower.includes('date')) {
      if (k.length < 25) {
        data.structured_data.invoice_date = v;
      }
    } else if (kLower.includes('total amount') || kLower.includes('total due') || kLower.includes('amount due') || kLower.includes('total')) {
      data.structured_data.total_amount = v;
    }
  }

  if (!data.structured_data.total_amount) {
    const amountRegex = /\$[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?/g;
    const amounts = rawText.match(amountRegex);
    if (amounts && amounts.length > 0) {
      data.structured_data.total_amount = amounts[0];
    }
  }

  return data;
}

function getTopGridFields(parsedJson: any) {
  const defaultFields = [
    { label: "Document Name", value: "—", colorClass: "var(--primary)" },
    { label: "Primary Email", value: "—", colorClass: "var(--secondary)" },
    { label: "First Date Found", value: "—", colorClass: "var(--text-primary)" },
  ];
  
  if (!parsedJson || !parsedJson.structured_data) return defaultFields;

  const sd = parsedJson.structured_data;
  const isResume = sd.extracted_key_values && (
    sd.extracted_key_values["Candidate Name"] || 
    sd.extracted_key_values["Skills Extracted"]
  );

  if (isResume) {
    return [
      { label: "Candidate Name", value: sd.extracted_key_values["Candidate Name"] || "—", colorClass: "var(--secondary)" },
      { label: "Phone Number", value: sd.extracted_key_values["Phone Number"] || "—", colorClass: "var(--success)" },
      { label: "Social Profiles", value: sd.extracted_key_values["Social Profiles"] || "—", colorClass: "var(--text-primary)" },
    ];
  }

  const hasInvoiceDetails = sd.invoice_number || sd.total_amount || sd.invoice_date;
  if (hasInvoiceDetails) {
    return [
      { label: "Invoice Number", value: sd.invoice_number || "—", colorClass: "var(--secondary)" },
      { label: "Total Amount", value: sd.total_amount || "—", colorClass: "var(--success)" },
      { label: "Invoice Date", value: sd.invoice_date || "—", colorClass: "var(--text-primary)" },
    ];
  }

  const firstEmail = sd.emails && sd.emails.length > 0 ? sd.emails[0] : null;
  const firstDate = sd.dates && sd.dates.length > 0 ? sd.dates[0] : null;
  return [
    { label: "Document Name", value: parsedJson.metadata?.filename || "—", colorClass: "var(--primary)" },
    { label: "Primary Email", value: firstEmail || "—", colorClass: "var(--secondary)" },
    { label: "First Date Found", value: firstDate || "—", colorClass: "var(--text-primary)" },
  ];
}

interface AttachmentCardProps {
  att: Attachment;
  copiedAttachmentId: string | null;
  copyToClipboard: (text: string, id: string) => void;
}

function AttachmentCard({ att, copiedAttachmentId, copyToClipboard }: AttachmentCardProps) {
  const [activeSubTab, setActiveSubTab] = useState<'image' | 'structured' | 'text' | 'json'>('structured');
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const isImage = att.mime_type.startsWith('image/');

  // Auto-select image tab when it's an image attachment
  const defaultTab: 'image' | 'structured' | 'text' | 'json' = isImage ? 'image' : 'structured';
  const [initDone, setInitDone] = useState(false);
  if (!initDone) {
    // This runs only once synchronously on first render
  }

  let parsedJson: any = null;
  let isJson = false;
  
  if (att.extracted_text) {
    try {
      parsedJson = JSON.parse(att.extracted_text);
      if (parsedJson && typeof parsedJson === 'object' && 'structured_data' in parsedJson) {
        isJson = true;
      }
    } catch (e) {
      // Parse failed, meaning legacy plain text
    }

    if (!isJson) {
      parsedJson = parseTextToStructuredData(att.filename, att.mime_type, att.extracted_text);
    }
  }

  const hasText = !!att.extracted_text;
  const currentTab = activeSubTab;
  const rawText = att.extracted_text ? (isJson ? parsedJson.raw_text : att.extracted_text) : '';

  // On first mount set correct default tab
  useEffect(() => {
    setActiveSubTab(isImage ? 'image' : 'structured');
  }, [att.id]);

  return (
    <>
      {/* Lightbox overlay for full-screen image */}
      {lightboxOpen && att.image_data && (
        <div
          onClick={() => setLightboxOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={att.image_data}
              alt={att.filename}
              style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: '8px', boxShadow: '0 0 60px rgba(0,0,0,0.8)', objectFit: 'contain' }}
            />
            <div style={{ textAlign: 'center', marginTop: '0.75rem', color: '#94a3b8', fontSize: '0.8rem' }}>
              {att.filename} — click anywhere to close
            </div>
          </div>
        </div>
      )}

    <div className="attachment-file-card" style={{ marginBottom: '1.25rem', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', background: 'rgba(255, 255, 255, 0.01)' }}>
      <div className="attachment-file-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div className="file-name-info" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Icon: image vs generic file */}
          {isImage ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--secondary)', flexShrink: 0 }}>
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--secondary)' }}>
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
            </svg>
          )}
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{att.filename}</span>
          <span className="file-size" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            ({(att.file_size_bytes / 1024).toFixed(1)} KB)
          </span>
          {isImage && (
            <span style={{ fontSize: '0.7rem', background: 'rgba(99,102,241,0.12)', color: 'var(--primary)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 600 }}>
              🖼 IMAGE
            </span>
          )}
        </div>
        
        <button 
          className="copy-btn"
          onClick={() => copyToClipboard(isJson ? JSON.stringify(parsedJson, null, 2) : (att.extracted_text || ''), att.id)}
          style={{ background: 'transparent', border: 'none', color: 'var(--secondary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
        >
          {copiedAttachmentId === att.id ? 'Copied!' : isJson ? 'Copy Structured JSON' : 'Copy Extracted Text'}
        </button>
      </div>

      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Type: <span style={{ fontFamily: 'monospace' }}>{att.mime_type}</span> | Processing Status: <span style={{ color: 'var(--success)', fontWeight: 600 }}>{att.processing_status}</span>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        {isImage && att.image_data && (
          <button 
            onClick={() => setActiveSubTab('image')}
            className="btn btn-secondary"
            style={{ 
              padding: '0.25rem 0.6rem', fontSize: '0.75rem', height: 'auto',
              background: currentTab === 'image' ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: currentTab === 'image' ? 'var(--primary)' : 'var(--text-secondary)',
              borderColor: currentTab === 'image' ? 'var(--border-highlight)' : 'transparent'
            }}
          >
            🖼 Image Preview
          </button>
        )}
        {hasText && (
          <>
            <button 
              onClick={() => setActiveSubTab('structured')}
              className="btn btn-secondary"
              style={{ 
                padding: '0.25rem 0.6rem', fontSize: '0.75rem', height: 'auto',
                background: currentTab === 'structured' ? 'var(--primary-glow)' : 'transparent',
                color: currentTab === 'structured' ? 'var(--primary)' : 'var(--text-secondary)',
                borderColor: currentTab === 'structured' ? 'var(--border-highlight)' : 'transparent'
              }}
            >
              📊 Structured Fields
            </button>
            <button 
              onClick={() => setActiveSubTab('text')}
              className="btn btn-secondary"
              style={{ 
                padding: '0.25rem 0.6rem', fontSize: '0.75rem', height: 'auto',
                background: currentTab === 'text' ? 'var(--primary-glow)' : 'transparent',
                color: currentTab === 'text' ? 'var(--primary)' : 'var(--text-secondary)',
                borderColor: currentTab === 'text' ? 'var(--border-highlight)' : 'transparent'
              }}
            >
              📝 Clean Text
            </button>
            <button 
              onClick={() => setActiveSubTab('json')}
              className="btn btn-secondary"
              style={{ 
                padding: '0.25rem 0.6rem', fontSize: '0.75rem', height: 'auto',
                background: currentTab === 'json' ? 'var(--primary-glow)' : 'transparent',
                color: currentTab === 'json' ? 'var(--primary)' : 'var(--text-secondary)',
                borderColor: currentTab === 'json' ? 'var(--border-highlight)' : 'transparent'
              }}
            >
              Code JSON
            </button>
          </>
        )}
      </div>

      {/* IMAGE PREVIEW TAB */}
      {currentTab === 'image' && att.image_data && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
          {/* Image thumbnail */}
          <div
            style={{
              width: '100%', maxHeight: '320px', overflow: 'hidden',
              borderRadius: '8px', border: '1px solid var(--border-color)',
              background: '#080a12',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'zoom-in',
              position: 'relative',
            }}
            onClick={() => setLightboxOpen(true)}
            title="Click to view full size"
          >
            <img
              src={att.image_data}
              alt={att.filename}
              style={{
                maxWidth: '100%',
                maxHeight: '320px',
                objectFit: 'contain',
                display: 'block',
                borderRadius: '8px',
              }}
            />
            {/* Zoom hint overlay */}
            <div style={{
              position: 'absolute', bottom: '8px', right: '10px',
              background: 'rgba(0,0,0,0.6)', borderRadius: '4px',
              padding: '0.2rem 0.5rem', fontSize: '0.7rem', color: '#94a3b8',
              pointerEvents: 'none',
            }}>
              🔍 Click to expand
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            {att.filename} &nbsp;·&nbsp; {att.mime_type} &nbsp;·&nbsp; {(att.file_size_bytes / 1024).toFixed(1)} KB
          </div>
        </div>
      )}

      {/* STRUCTURED TAB */}
      {currentTab === 'structured' && parsedJson && (
        <div className="custom-horizontal-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#080a12', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '1rem', overflowX: 'auto' }}>
          <div style={{ minWidth: '100%', width: 'max-content', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
              {getTopGridFields(parsedJson).slice(0, 2).map((field, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{field.label}</span>
                  <span style={{ fontSize: '0.85rem', color: field.colorClass, fontWeight: 600 }}>
                    {field.value}
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: '0.25rem', gridColumn: 'span 2' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                  {getTopGridFields(parsedJson)[2]?.label}
                </span>
                <span style={{ fontSize: '0.85rem', color: getTopGridFields(parsedJson)[2]?.colorClass }}>
                  {getTopGridFields(parsedJson)[2]?.value}
                </span>
              </div>
            </div>
            
            {parsedJson.structured_data.emails && parsedJson.structured_data.emails.length > 0 && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Emails Found</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {parsedJson.structured_data.emails.map((email: string, i: number) => (
                    <span key={i} style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                      {email}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {parsedJson.structured_data.extracted_key_values && Object.keys(parsedJson.structured_data.extracted_key_values).length > 0 && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Extracted Fields</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {Object.entries(parsedJson.structured_data.extracted_key_values).map(([key, val]: any) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', fontSize: '0.8rem', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '0.35rem', paddingTop: '0.35rem' }}>
                      <span style={{ color: 'var(--text-secondary)', width: '180px', flexShrink: 0, fontWeight: 600 }}>{key}</span>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap', flexGrow: 1 }}>
                        {val}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TEXT TAB */}
      {currentTab === 'text' && (
        rawText ? (
          <pre style={{ 
            margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.85rem',
            lineHeight: '1.6', color: '#cbd5e1', background: '#080a12',
            border: '1px solid var(--border-color)', borderRadius: '6px',
            padding: '1rem', maxHeight: '300px', overflowY: 'auto' 
          }}>
            {rawText}
          </pre>
        ) : (
          <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '0.8rem' }}>No text content could be extracted from this file.</div>
        )
      )}

      {/* JSON TAB */}
      {currentTab === 'json' && parsedJson && (
        <pre className="extracted-box" style={{ margin: 0, color: 'var(--warning)', borderColor: 'rgba(245, 158, 11, 0.2)', background: 'rgba(245, 158, 11, 0.02)' }}>
          {JSON.stringify(parsedJson, null, 2)}
        </pre>
      )}
    </div>
    </>
  );
}

interface EmailBodyCardProps {
  body: string;
  subject: string;
}

function EmailBodyCard({ body, subject }: EmailBodyCardProps) {
  const [activeSubTab, setActiveSubTab] = useState<'structured' | 'text' | 'json'>('text');
  
  let parsedJson: any = null;
  let isJson = false;
  
  if (body) {
    try {
      parsedJson = JSON.parse(body);
      if (parsedJson && typeof parsedJson === 'object' && 'structured_data' in parsedJson) {
        isJson = true;
      }
    } catch (e) {
      // Parse failed, meaning standard plain text email body
    }

    if (!isJson) {
      parsedJson = parseTextToStructuredData("Email Body", "text/plain", body);
    }
  }

  const hasText = !!body;
  const currentTab = hasText ? activeSubTab : 'text';
  const rawText = body ? (isJson ? parsedJson.raw_text : body) : '';

  // Determine if we found structured fields (invoice data, key-values, or emails) to default to structured view
  const hasStructuredFields = parsedJson && (
    parsedJson.structured_data.invoice_number ||
    parsedJson.structured_data.total_amount ||
    parsedJson.structured_data.invoice_date ||
    parsedJson.structured_data.emails.length > 0 ||
    Object.keys(parsedJson.structured_data.extracted_key_values).length > 0
  );

  useEffect(() => {
    if (hasStructuredFields) {
      setActiveSubTab('structured');
    } else {
      setActiveSubTab('text');
    }
  }, [body]);

  return (
    <div className="email-body-card" style={{ marginBottom: '1.25rem', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', background: 'rgba(255, 255, 255, 0.01)' }}>
      {hasText && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '0.5rem' }}>
          <button 
            onClick={() => setActiveSubTab('structured')}
            className={`btn btn-secondary`}
            style={{ 
              padding: '0.25rem 0.6rem', 
              fontSize: '0.75rem', 
              height: 'auto',
              background: currentTab === 'structured' ? 'var(--primary-glow)' : 'transparent',
              color: currentTab === 'structured' ? 'var(--primary)' : 'var(--text-secondary)',
              borderColor: currentTab === 'structured' ? 'var(--border-highlight)' : 'transparent'
            }}
          >
            📊 Structured Fields
          </button>
          <button 
            onClick={() => setActiveSubTab('text')}
            className={`btn btn-secondary`}
            style={{ 
              padding: '0.25rem 0.6rem', 
              fontSize: '0.75rem', 
              height: 'auto',
              background: currentTab === 'text' ? 'var(--primary-glow)' : 'transparent',
              color: currentTab === 'text' ? 'var(--primary)' : 'var(--text-secondary)',
              borderColor: currentTab === 'text' ? 'var(--border-highlight)' : 'transparent'
            }}
          >
            📝 Clean Text
          </button>
          <button 
            onClick={() => setActiveSubTab('json')}
            className={`btn btn-secondary`}
            style={{ 
              padding: '0.25rem 0.6rem', 
              fontSize: '0.75rem', 
              height: 'auto',
              background: currentTab === 'json' ? 'var(--primary-glow)' : 'transparent',
              color: currentTab === 'json' ? 'var(--primary)' : 'var(--text-secondary)',
              borderColor: currentTab === 'json' ? 'var(--border-highlight)' : 'transparent'
            }}
          >
            Code JSON
          </button>
        </div>
      )}

      {/* Tab Renderings */}
      {currentTab === 'structured' && parsedJson && (
        <div className="custom-horizontal-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#080a12', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '1rem', overflowX: 'auto' }}>
          <div style={{ minWidth: '100%', width: 'max-content', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
              {getTopGridFields(parsedJson).slice(0, 2).map((field, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{field.label}</span>
                  <span style={{ fontSize: '0.85rem', color: field.colorClass, fontWeight: 600 }}>
                    {field.value}
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: '0.25rem', gridColumn: 'span 2' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                  {getTopGridFields(parsedJson)[2]?.label}
                </span>
                <span style={{ fontSize: '0.85rem', color: getTopGridFields(parsedJson)[2]?.colorClass }}>
                  {getTopGridFields(parsedJson)[2]?.value}
                </span>
              </div>
            </div>
            
            {parsedJson.structured_data.emails && parsedJson.structured_data.emails.length > 0 && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Emails in Body</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {parsedJson.structured_data.emails.map((email: string, i: number) => (
                    <span key={i} style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                      {email}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {parsedJson.structured_data.extracted_key_values && Object.keys(parsedJson.structured_data.extracted_key_values).length > 0 && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Key Details</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {Object.entries(parsedJson.structured_data.extracted_key_values).map(([key, val]: any) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', fontSize: '0.8rem', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '0.35rem', paddingTop: '0.35rem' }}>
                      <span style={{ color: 'var(--text-secondary)', width: '180px', flexShrink: 0, fontWeight: 600 }}>{key}</span>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap', flexGrow: 1 }}>
                        {val}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {currentTab === 'text' && (
        rawText ? (
          <pre style={{ 
            margin: 0, 
            whiteSpace: 'pre-wrap', 
            fontFamily: 'inherit', 
            fontSize: '0.85rem', 
            lineHeight: '1.6', 
            color: '#cbd5e1', 
            background: '#080a12', 
            border: '1px solid var(--border-color)', 
            borderRadius: '6px', 
            padding: '1rem', 
            maxHeight: '300px', 
            overflowY: 'auto' 
          }}>
            {rawText}
          </pre>
        ) : (
          <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '0.8rem' }}>No text content found in email body.</div>
        )
      )}

      {currentTab === 'json' && parsedJson && (
        <pre className="extracted-box" style={{ margin: 0, color: 'var(--warning)', borderColor: 'rgba(245, 158, 11, 0.2)', background: 'rgba(245, 158, 11, 0.02)' }}>
          {JSON.stringify(parsedJson, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'emails'>('dashboard');
  
  // Data States
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [emailsData, setEmailsData] = useState<{ items: Email[]; total: number; page: number; pages: number } | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [userStatus, setUserStatus] = useState<{ authenticated: boolean; email: string | null; mode: string } | null>(null);
  
  // Query Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [senderFilter, setSenderFilter] = useState('');
  const [attachmentTypeFilter, setAttachmentTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  
  // UI Status
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [copiedAttachmentId, setCopiedAttachmentId] = useState<string | null>(null);
  const [nextSyncCountdown, setNextSyncCountdown] = useState(30);

  // Fetch Dashboard Stats
  const fetchMetrics = async () => {
    setApiError(null);
    try {
      const res = await fetch(`${API_BASE}/dashboard/metrics`, { credentials: 'include' });
      if (res.status === 401) {
        setMetrics(null);
        return;
      }
      if (!res.ok) throw new Error('Failed to load metrics');
      const data = await res.json();
      setMetrics(data);
    } catch (err: any) {
      console.error(err);
      setApiError('Could not connect to FastAPI server. Please ensure the backend is running on port 8000.');
    } finally {
      // Done fetching
    }
  };

  // Fetch Emails Table
  const fetchEmails = async () => {
    setIsLoadingEmails(true);
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: '8',
      });
      if (statusFilter) params.append('status', statusFilter);
      if (searchQuery) params.append('search', searchQuery);
      if (senderFilter) params.append('sender', senderFilter);
      if (attachmentTypeFilter) params.append('attachment_type', attachmentTypeFilter);
      if (startDateFilter) params.append('start_date', startDateFilter);
      if (endDateFilter) params.append('end_date', endDateFilter);

      const res = await fetch(`${API_BASE}/emails?${params.toString()}`, { credentials: 'include' });
      if (res.status === 401) {
        setEmailsData(null);
        return;
      }
      if (!res.ok) throw new Error('Failed to load emails');
      const data = await res.json();
      setEmailsData(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingEmails(false);
    }
  };

  // Fetch single email detail on select
  const handleEmailClick = async (emailId: string) => {
    try {
      const res = await fetch(`${API_BASE}/emails/${emailId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load email details');
      const data = await res.json();
      setSelectedEmail(data);
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch active authentication status
  const fetchUserStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/google/status`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUserStatus(data);
      }
    } catch (err) {
      console.error('Error fetching auth status:', err);
    }
  };

  // Trigger Manual Sync
  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/emails/sync`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json();
      if (data.status === 'unauthorized') {
        if (confirm("Gmail account is not connected. Connect now?")) {
          handleChangeUser();
        }
        return;
      } else if (data.status === 'api_error' || data.status === 'error') {
        alert(`Synchronization failed: ${data.message}`);
        return;
      }
      await Promise.all([fetchMetrics(), fetchEmails()]);
      setNextSyncCountdown(30);
    } catch (err: any) {
      alert(`Synchronization failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Disconnect Gmail Token
  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect this Google account?")) {
      return;
    }
    setIsDisconnecting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/google/logout`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Logout failed');
      await fetchUserStatus();
      alert("Successfully disconnected Google account.");
    } catch (err: any) {
      alert(`Disconnect failed: ${err.message}`);
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Change User/Connect Redirect
  const handleChangeUser = () => {
    if (userStatus && userStatus.authenticated) {
      const confirmSwitch = confirm(
        "Aap dusra Gmail connect karne ja rahe hain.\n\nNaye Gmail account ko login karne se pehle use Google Cloud Console me 'Test Users' list me add karna zaroori hai (varna Google login block kar dega).\n\nKya aap naya user add karne ke liye Google Cloud Console (OAuth consent screen) ko new tab me open karna chahte hain?"
      );
      if (confirmSwitch) {
        window.open("https://console.cloud.google.com/apis/credentials/consent", "_blank");
      }
    }
    window.location.href = `${API_BASE}/auth/google/login`;
  };

  // Initial Fetch & Poll
  useEffect(() => {
    fetchMetrics();
    fetchEmails();
    fetchUserStatus();
  }, [currentPage, statusFilter, attachmentTypeFilter, startDateFilter, endDateFilter]);

  // Auto-sync countdown timer (matches backend 30s background sync)
  useEffect(() => {
    const timer = setInterval(() => {
      setNextSyncCountdown((prev) => {
        if (prev <= 1) {
          fetchMetrics();
          fetchEmails();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Debounced search trigger
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      setCurrentPage(1);
      fetchEmails();
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery, senderFilter]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAttachmentId(id);
    setTimeout(() => setCopiedAttachmentId(null), 2000);
  };

  // Helpers
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed': return <span className="badge badge-completed">Completed</span>;
      case 'pending': return <span className="badge badge-pending">Pending</span>;
      case 'failed': return <span className="badge badge-failed">Failed</span>;
      case 'processing': return <span className="badge badge-processing">Processing</span>;
      default: return <span className="badge">{status}</span>;
    }
  };

  // Donut Chart calculations for Attachment Distribution
  const mimeEntries = metrics && metrics.processing_by_mime ? Object.entries(metrics.processing_by_mime) : [];
  const totalMimeCount = mimeEntries.reduce((sum, [_, count]) => sum + count, 0);
  const donutColors = ['#ff5e62', '#ff9966', '#10b981', '#fbbf24', '#38bdf8', '#a855f7', '#ec4899'];
  const donutRadius = 38;
  const donutStrokeWidth = 8;
  const donutCircumference = 2 * Math.PI * donutRadius;

  let accumulatedPercent = 0;
  const donutCircles = mimeEntries.map(([mime, count], index) => {
    const percent = totalMimeCount > 0 ? count / totalMimeCount : 0;
    const strokeLength = percent * donutCircumference;
    const strokeOffset = donutCircumference - (accumulatedPercent * donutCircumference);
    accumulatedPercent += percent;
    const color = donutColors[index % donutColors.length];

    return (
      <circle
        key={mime}
        cx="50"
        cy="50"
        r={donutRadius}
        fill="transparent"
        stroke={color}
        strokeWidth={donutStrokeWidth}
        strokeDasharray={`${strokeLength} ${donutCircumference - strokeLength}`}
        strokeDashoffset={strokeOffset}
        transform="rotate(-90 50 50)"
      />
    );
  });

  return (
    <div className="dashboard-container">
      {/* 1. Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
          </svg>
          <span>InboxParser</span>
        </div>
        
        <ul className="sidebar-menu">
          <li>
            <div 
              className={`sidebar-item ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9"></rect>
                <rect x="14" y="3" width="7" height="5"></rect>
                <rect x="14" y="12" width="7" height="9"></rect>
                <rect x="3" y="16" width="7" height="5"></rect>
              </svg>
              Overview
            </div>
          </li>
          <li>
            <div 
              className={`sidebar-item ${activeTab === 'emails' ? 'active' : ''}`}
              onClick={() => setActiveTab('emails')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                <polyline points="22,6 12,13 2,6"></polyline>
              </svg>
              Emails Logs
            </div>
          </li>
        </ul>

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', flexShrink: 0 }}>
          {userStatus ? (
            userStatus.authenticated ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="user-avatar" style={{ background: 'var(--primary-glow)', color: 'var(--primary)', border: '1px solid var(--primary)', flexShrink: 0 }}>
                    {userStatus.email ? userStatus.email[0].toUpperCase() : 'U'}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontSize: '0.8rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', margin: 0 }}>
                      {userStatus.email}
                    </p>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'capitalize', margin: 0 }}>
                      Gmail Connected ({userStatus.mode} mode)
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', width: '100%' }}>
                  <button 
                    onClick={handleChangeUser}
                    className="btn btn-secondary"
                    style={{ flex: 1, padding: '0.35rem 0.5rem', fontSize: '0.75rem', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="8.5" cy="7" r="4"></circle>
                      <line x1="18" y1="8" x2="23" y2="13"></line>
                      <line x1="23" y1="8" x2="18" y2="13"></line>
                    </svg>
                    Change User
                  </button>
                  <button 
                    onClick={handleDisconnect}
                    disabled={isDisconnecting}
                    className="btn btn-secondary"
                    style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', height: 'auto', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                    title="Disconnect Account"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="user-avatar" style={{ background: '#334155', color: '#94a3b8', flexShrink: 0 }}>?</div>
                  <div>
                    <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', margin: 0 }}>Gmail Not Connected</p>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0, textTransform: 'capitalize' }}>{userStatus.mode} Mode</p>
                  </div>
                </div>
                <button 
                  onClick={handleChangeUser}
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '0.4rem', fontSize: '0.75rem', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                    <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.56h3.29c1.92,-1.77 3.02,-4.38 3.02,-7.4C21.65,11.83 21.53,11.4 21.35,11.1z" fill="#4285F4"/>
                    <path d="M12,21c2.43,0 4.47,-0.8 5.96,-2.18l-3.29,-2.56c-0.9,-0.6 -2.07,-0.98 -3.29,-0.98c-2.33,0 -4.3,-1.58 -5,-3.71H3.04v2.6C4.52,17.2 8.01,21 12,21z" fill="#34A853"/>
                    <path d="M7,11.57c-0.18,-0.53 -0.28,-1.1 -0.28,-1.69s0.1,-1.16 0.28,-1.69V5.59H3.04C2.37,6.92 2,8.42 2,10s0.37,3.08 1.04,4.41L7,11.57z" fill="#FBBC05"/>
                    <path d="M12,7.3c1.32,0 2.5,0.45 3.44,1.35l2.58,-2.58C16.46,4.5 14.43,3.7 12,3.7C8.01,3.7 4.52,7.5 3.04,11.41l3.96,-3.1C7.7,6.18 9.67,4.5 12,7.3z" fill="#EA4335"/>
                  </svg>
                  Connect Gmail
                </button>
              </div>
            )
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div className="animate-spin user-avatar" style={{ border: '2px solid var(--border-color)', borderTopColor: 'var(--primary)', width: '32px', height: '32px', flexShrink: 0 }}></div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Loading session...</p>
            </div>
          )}
        </div>
      </aside>

      {/* 2. Main Content */}
      <main className="main-content">
        
        {/* Top Header */}
        <header className="top-header">
          <div className="header-title">
            <h1>{activeTab === 'dashboard' ? 'Analytics Overview' : 'Email Processing Logs'}</h1>
            <p>{activeTab === 'dashboard' ? 'Real-time performance and attachment statistics' : 'Search, review, and extract text data'}</p>
          </div>
          
          <div className="header-actions">
            <button 
              className={`btn btn-primary ${isSyncing ? 'loading' : ''}`}
              onClick={handleManualSync}
              disabled={isSyncing}
            >
              {isSyncing ? (
                <>
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="2" x2="12" y2="6"></line>
                    <line x1="12" y1="18" x2="12" y2="22"></line>
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                    <line x1="2" y1="12" x2="6" y2="12"></line>
                    <line x1="18" y1="12" x2="22" y2="12"></line>
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                  </svg>
                  Syncing Gmail...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                  </svg>
                  Sync Inbox
                </>
              )}
            </button>
          </div>
        </header>

        {apiError && (
          <div className="summary-box" style={{ background: 'var(--danger-glow)', borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: '2rem' }}>
            <div className="summary-title" style={{ color: 'var(--danger)' }}>Connection Error</div>
            <p>{apiError}</p>
            <button className="btn btn-secondary" onClick={() => { fetchMetrics(); fetchEmails(); }} style={{ marginTop: '0.75rem', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>Retry Connection</button>
          </div>
        )}

        {/* TAB 1: DASHBOARD VIEW */}
        {activeTab === 'dashboard' && (
          <div className="animate-fade-in">
            {/* Stat Cards */}
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-info">
                  <h3>Total Emails Processed</h3>
                  <div className="metric-value">{metrics ? metrics.total_emails_processed : '—'}</div>
                </div>
                <div className="metric-icon icon-blue">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                  </svg>
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-info">
                  <h3>Failed Tasks</h3>
                  <div className="metric-value" style={{ color: metrics && metrics.failed_emails > 0 ? 'var(--danger)' : 'inherit' }}>
                    {metrics ? metrics.failed_emails : '—'}
                  </div>
                </div>
                <div className="metric-icon icon-red">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-info">
                  <h3>Success Rate</h3>
                  <div className="metric-value">{metrics ? `${metrics.success_rate_percentage}%` : '—'}</div>
                </div>
                <div className="metric-icon icon-green">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                </div>
              </div>
              <div className="metric-card" style={{ background: 'linear-gradient(135deg, rgba(255, 94, 98, 0.05) 0%, rgba(255, 153, 102, 0.05) 100%)', borderColor: 'var(--border-highlight)' }}>
                <div className="metric-info">
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)' }}>
                    <span className="live-pulse-dot" style={{ display: 'inline-block', width: '6px', height: '6px', backgroundColor: 'var(--success)', borderRadius: '50%', boxShadow: '0 0 8px var(--success)' }} />
                    Live Polling
                  </h3>
                  <div className="metric-value" style={{ fontSize: '1.25rem', marginTop: '0.65rem', fontWeight: 700 }}>
                    Sync in <span style={{ color: 'var(--secondary)', fontFamily: 'monospace' }}>{nextSyncCountdown}s</span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Interval: 30s auto-check</span>
                </div>
                <div className="metric-icon" style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={isSyncing ? 'animate-spin' : ''}>
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                  </svg>
                </div>
              </div>
            </div>

            {/* Charts Row */}
            <div className="analytics-row">
              <div className="analytics-card">
                <div className="card-header">
                  <h2>Processing History (Last 7 Days)</h2>
                </div>
                <div className="bar-chart-container">
                  {metrics && metrics.timeline && metrics.timeline.length > 0 ? (
                    metrics.timeline.map((day, idx) => {
                      const total = day.processed + day.failed;
                      const maxVal = Math.max(...metrics.timeline.map(d => d.processed + d.failed), 5);
                      const processedPercent = total > 0 ? (day.processed / maxVal) * 100 : 0;
                      const failedPercent = total > 0 ? (day.failed / maxVal) * 100 : 0;

                      return (
                        <div key={idx} className="chart-bar-group">
                          <div className="bar-wrapper" style={{ height: '140px' }}>
                            {day.processed > 0 && (
                              <div 
                                className="chart-bar" 
                                style={{ height: `${processedPercent}%`, position: 'absolute', bottom: 0 }}
                                title={`${day.processed} processed`}
                              />
                            )}
                            {day.failed > 0 && (
                              <div 
                                className="chart-bar-failed" 
                                style={{ height: `${failedPercent}%`, position: 'absolute', bottom: `${processedPercent}%` }}
                                title={`${day.failed} failed`}
                              />
                            )}
                          </div>
                          <span className="bar-label">{day.date.substring(5)}</span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="empty-state">No statistics timeline data available. Run sync to generate logs.</div>
                  )}
                </div>
              </div>

              <div className="analytics-card">
                <div className="card-header">
                  <h2>Attachment Distribution</h2>
                </div>
                {metrics && metrics.processing_by_mime && Object.keys(metrics.processing_by_mime).length > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap', justifyContent: 'center', paddingTop: '0.5rem' }}>
                    {/* Donut Chart */}
                    <div style={{ position: 'relative', width: '120px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="120" height="120" viewBox="0 0 100 100">
                        {/* Background track */}
                        <circle
                          cx="50"
                          cy="50"
                          r={donutRadius}
                          fill="transparent"
                          stroke="rgba(255, 255, 255, 0.04)"
                          strokeWidth={donutStrokeWidth}
                        />
                        {donutCircles}
                      </svg>
                      <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                        <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{totalMimeCount}</span>
                        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '2px' }}>Files</span>
                      </div>
                    </div>

                    {/* Legend List */}
                    <div className="mime-list" style={{ flex: 1, minWidth: '150px', gap: '0.75rem' }}>
                      {mimeEntries.map(([mime, count], index) => {
                        const dotColor = donutColors[index % donutColors.length];
                        const percentage = totalMimeCount > 0 ? ((count / totalMimeCount) * 100).toFixed(0) : '0';
                        return (
                          <div key={mime} className="mime-item" style={{ fontSize: '0.85rem' }}>
                            <div className="mime-label">
                              <span className="mime-dot" style={{ backgroundColor: dotColor, width: '7px', height: '7px' }} />
                              <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{mime.split('/')[1]?.toUpperCase() || mime}</span>
                            </div>
                            <span className="mime-value" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                              {count} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>({percentage}%)</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: '2rem' }}>No attachments found yet.</div>
                )}
              </div>
            </div>

            {/* Recent Extractions Feed */}
            <div className="analytics-card" style={{ marginTop: '1.5rem' }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h2>Recent Extractions & Activity Feed</h2>
                <button 
                  onClick={() => setActiveTab('emails')} 
                  className="btn btn-secondary" 
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', height: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  View All Logs
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                  </svg>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {emailsData && emailsData.items.length > 0 ? (
                  emailsData.items.slice(0, 4).map((email) => {
                    let detailsText = '';
                    let attachmentBadge = null;

                    if (email.attachments && email.attachments.length > 0) {
                      const att = email.attachments[0];
                      attachmentBadge = (
                        <span style={{ fontSize: '0.7rem', color: 'var(--secondary)', display: 'inline-flex', alignItems: 'center', gap: '2px', background: 'rgba(255, 153, 102, 0.08)', padding: '0.15rem 0.35rem', borderRadius: '4px', border: '1px solid rgba(255, 153, 102, 0.15)' }}>
                          📎 {att.filename}
                        </span>
                      );
                      
                      if (att.extracted_text) {
                        try {
                          const parsed = JSON.parse(att.extracted_text);
                          if (parsed && parsed.structured_data) {
                            const sd = parsed.structured_data;
                            if (sd.total_amount) detailsText = `Total: ${sd.total_amount}`;
                            else if (sd.invoice_number) detailsText = `Inv: ${sd.invoice_number}`;
                            else if (sd.extracted_key_values && Object.keys(sd.extracted_key_values).length > 0) {
                              const [k, v] = Object.entries(sd.extracted_key_values)[0];
                              detailsText = `${k}: ${v}`;
                            }
                          }
                        } catch (e) {
                          const parsed = parseTextToStructuredData(att.filename, att.mime_type, att.extracted_text);
                          const sd = parsed.structured_data;
                          if (sd.total_amount) detailsText = `Total: ${sd.total_amount}`;
                        }
                      }
                    } else if (email.body) {
                      try {
                        const parsed = JSON.parse(email.body);
                        if (parsed && parsed.structured_data) {
                          const sd = parsed.structured_data;
                          if (sd.total_amount) detailsText = `Total: ${sd.total_amount}`;
                          else if (sd.invoice_number) detailsText = `Inv: ${sd.invoice_number}`;
                        }
                      } catch (e) {
                        const parsed = parseTextToStructuredData("Body", "text/plain", email.body);
                        const sd = parsed.structured_data;
                        if (sd.total_amount) detailsText = `Total: ${sd.total_amount}`;
                      }
                    }

                    if (!detailsText && email.summary) {
                      detailsText = email.summary;
                    } else if (!detailsText) {
                      detailsText = "Extracted clean text content successfully.";
                    }

                    return (
                      <div 
                        key={email.id}
                        onClick={() => handleEmailClick(email.id)}
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between', 
                          padding: '0.85rem 1.25rem', 
                          background: 'rgba(255, 255, 255, 0.01)', 
                          border: '1px solid var(--border-color)', 
                          borderRadius: '8px', 
                          cursor: 'pointer',
                        }}
                        className="recent-activity-row"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: 1 }}>
                          <div 
                            className="user-avatar" 
                            style={{ 
                              width: '32px', 
                              height: '32px', 
                              fontSize: '0.8rem', 
                              background: 'var(--primary-glow)', 
                              color: 'var(--primary)',
                              border: '1px solid var(--border-highlight)',
                              flexShrink: 0
                            }}
                          >
                            {email.sender ? email.sender[0].toUpperCase() : 'E'}
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                {email.sender ? email.sender.split('<')[0].trim() : 'Unknown'}
                              </span>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{formatDate(email.received_at)}</span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.15rem' }}>
                              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{email.subject}</span>
                              {detailsText && ` — ${detailsText}`}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginLeft: '1rem', flexShrink: 0 }}>
                          {attachmentBadge}
                          {getStatusBadge(email.processing_status)}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="empty-state" style={{ padding: '2rem' }}>No recent activities found.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: EMAILS LIST LOGS VIEW */}
        {activeTab === 'emails' && (
          <div className="table-section animate-fade-in">
            {/* Table Filters */}
            <div className="table-controls" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem 1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', width: '100%' }}>
                
                {/* 1. General Keyword Search */}
                <div className="search-input-wrapper" style={{ maxWidth: 'none' }}>
                  <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <input 
                    type="text" 
                    className="search-input" 
                    placeholder="Search subject, body..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                {/* 2. Sender Name Search */}
                <div className="search-input-wrapper" style={{ maxWidth: 'none' }}>
                  <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)' }}>
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                  <input 
                    type="text" 
                    className="search-input" 
                    placeholder="Filter by Sender Name..."
                    value={senderFilter}
                    onChange={(e) => setSenderFilter(e.target.value)}
                  />
                </div>

                {/* 3. Attachment Type Dropdown */}
                <select 
                  className="filter-select"
                  value={attachmentTypeFilter}
                  onChange={(e) => { setAttachmentTypeFilter(e.target.value); setCurrentPage(1); }}
                  style={{ width: '100%', height: '38px' }}
                >
                  <option value=""> All Attachments</option>
                  <option value="none"> No Attachments</option>
                  <option value="any"> Any Attachment</option>
                  <option value="pdf"> PDF Documents (.pdf)</option>
                  <option value="image"> Images (.png, .jpg)</option>
                  <option value="text"> Text Files (.txt)</option>
                  <option value="other"> Other Formats</option>
                </select>

                {/* 4. Processing Status Dropdown */}
                <select 
                  className="filter-select"
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                  style={{ width: '100%', height: '38px' }}
                >
                  <option value=""> All Statuses</option>
                  <option value="completed">Completed</option>
                  <option value="processing">Processing</option>
                  <option value="failed">Failed</option>
                </select>
              </div>

              {/* Second row: Dates and Reset button */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', width: '100%', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Date Range:</span>
                  <input 
                    type="date" 
                    className="search-input" 
                    style={{ padding: '0.4rem 0.6rem 0.4rem 0.6rem', width: '145px', fontSize: '0.8rem' }}
                    value={startDateFilter}
                    onChange={(e) => { setStartDateFilter(e.target.value); setCurrentPage(1); }}
                    placeholder="Start Date"
                  />
                  <span style={{ color: 'var(--text-muted)' }}>to</span>
                  <input 
                    type="date" 
                    className="search-input" 
                    style={{ padding: '0.4rem 0.6rem 0.4rem 0.6rem', width: '145px', fontSize: '0.8rem' }}
                    value={endDateFilter}
                    onChange={(e) => { setEndDateFilter(e.target.value); setCurrentPage(1); }}
                    placeholder="End Date"
                  />
                </div>

                <button 
                  className="btn btn-secondary"
                  onClick={() => {
                    setSearchQuery('');
                    setSenderFilter('');
                    setAttachmentTypeFilter('');
                    setStatusFilter('');
                    setStartDateFilter('');
                    setEndDateFilter('');
                    setCurrentPage(1);
                  }}
                  style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', height: '32px', marginLeft: 'auto' }}
                >
                  Reset Filters
                </button>
              </div>
            </div>

            {/* Custom Table */}
            {isLoadingEmails ? (
              <div className="empty-state">
                <svg className="animate-spin" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--primary)', marginBottom: '1rem' }}>
                  <line x1="12" y1="2" x2="12" y2="6"></line>
                  <line x1="12" y1="18" x2="12" y2="22"></line>
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                  <line x1="2" y1="12" x2="6" y2="12"></line>
                  <line x1="18" y1="12" x2="22" y2="12"></line>
                </svg>
                <p>Loading email database...</p>
              </div>
            ) : emailsData && emailsData.items.length > 0 ? (
              <>
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>Sender</th>
                      <th>Subject</th>
                      <th>Attachments</th>
                      <th>Status</th>
                      <th>Received Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emailsData.items.map((email) => (
                      <tr key={email.id} onClick={() => handleEmailClick(email.id)}>
                        <td className="sender-cell">{email.sender}</td>
                        <td className="subject-cell">
                          <div style={{ fontWeight: 600 }}>{email.subject}</div>
                          {email.summary && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.2rem' }}>{email.summary}</div>}
                        </td>
                        <td>
                          {email.attachment_count && email.attachment_count > 0 ? (
                            <span className="attachments-badge">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                              </svg>
                              {email.attachment_count} file(s)
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>None</span>
                          )}
                        </td>
                        <td>{getStatusBadge(email.processing_status)}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{formatDate(email.received_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination Controls */}
                {emailsData.pages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '1rem 1.5rem', gap: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
                    <button 
                      className="btn btn-secondary" 
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    >
                      Previous
                    </button>
                    <span style={{ display: 'flex', alignItems: 'center', fontSize: '0.85rem', padding: '0 0.5rem', color: 'var(--text-secondary)' }}>
                      Page {currentPage} of {emailsData.pages}
                    </span>
                    <button 
                      className="btn btn-secondary" 
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                      disabled={currentPage === emailsData.pages}
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, emailsData.pages))}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M8 12h8"></path>
                </svg>
                <p>No matching email logs found in database.</p>
                <button className="btn btn-secondary" onClick={handleManualSync} style={{ marginTop: '1rem' }}>Fetch Gmail Emails</button>
              </div>
            )}
          </div>
        )}

        {/* 3. Detail Slide Drawer / Modal */}
        {selectedEmail && (
          <div className="modal-overlay" onClick={() => setSelectedEmail(null)}>
            <div className="modal-content animate-slide-in" onClick={(e) => e.stopPropagation()}>
              
              <div className="modal-header">
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>{selectedEmail.subject}</h2>
                  {getStatusBadge(selectedEmail.processing_status)}
                </div>
                <button className="modal-close" onClick={() => setSelectedEmail(null)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              {/* Meta information */}
              <div style={{ marginBottom: '1.5rem' }}>
                <div className="meta-row">
                  <span className="meta-label">Sender:</span>
                  <span className="meta-value" style={{ fontWeight: 600 }}>{selectedEmail.sender}</span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">Recipient:</span>
                  <span className="meta-value">{selectedEmail.recipient}</span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">Received:</span>
                  <span className="meta-value">{selectedEmail.received_at ? formatDate(selectedEmail.received_at) : '—'}</span>
                </div>
              </div>

              {/* Summary Block */}
              {selectedEmail.summary && (
                <div className="summary-box">
                  <div className="summary-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polygon points="12 2 2 22 22 22"></polygon>
                      <line x1="12" y1="9" x2="12" y2="13"></line>
                      <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    AI Processing Summary
                  </div>
                  <p style={{ fontSize: '0.85rem', lineHeight: '1.5', color: '#cbd5e1' }}>{selectedEmail.summary}</p>
                </div>
              )}

              {/* Email Content Body */}
              <h3 className="attachment-section-title">Email Body</h3>
              <EmailBodyCard body={selectedEmail.body || ''} subject={selectedEmail.subject} />

              {/* Attachments Section */}
              <h3 className="attachment-section-title">
                Parsed Attachments ({selectedEmail.attachments ? selectedEmail.attachments.length : 0})
              </h3>

              {selectedEmail.attachments && selectedEmail.attachments.length > 0 ? (
                selectedEmail.attachments.map((att) => (
                  <AttachmentCard 
                    key={att.id} 
                    att={att} 
                    copiedAttachmentId={copiedAttachmentId} 
                    copyToClipboard={copyToClipboard}
                  />
                ))
              ) : (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem', padding: '0.5rem 0' }}>This email does not contain any attachments.</div>
              )}

            </div>
          </div>
        )}

      </main>
    </div>
  );
}
