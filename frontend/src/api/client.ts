import axios, { AxiosError } from 'axios';

export const TOKEN_KEY = 'orderez-token';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || '/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 45000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string | string[] }>) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
    }
    const raw = error.response?.data?.message;
    const message = Array.isArray(raw) ? raw.join(' · ') : raw;
    return Promise.reject(new Error(italianError(error, message)));
  },
);

function italianError(error: AxiosError, apiMessage?: string): string {
  if (apiMessage) return apiMessage;
  if (!error.response) return 'Server non raggiungibile. Verifica la connessione.';
  const map: Record<number, string> = {
    400: 'I dati inviati non sono validi.',
    401: 'Sessione scaduta o credenziali non valide.',
    403: 'Non hai i permessi per questa operazione.',
    404: 'Risorsa non trovata.',
    409: 'Operazione non consentita: esiste già un dato collegato.',
    429: 'Troppe richieste. Riprova tra poco.',
    500: 'Errore interno del server.',
  };
  return map[error.response.status] ?? 'Errore imprevisto del server.';
}

function saveBlob(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

export async function downloadFile(url: string, params: Record<string, unknown>, filename: string) {
  const response = await api.get(url, { params, responseType: 'blob' });
  saveBlob(response.data, filename);
}

/** Export via POST (l'elenco degli id selezionati non sta nell'URL). */
export async function downloadFilePost(url: string, body: Record<string, unknown>, filename: string) {
  const response = await api.post(url, body, { responseType: 'blob' });
  saveBlob(response.data, filename);
}
