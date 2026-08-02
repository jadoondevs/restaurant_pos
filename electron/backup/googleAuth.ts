/**
 * Google OAuth 2.0 PKCE loopback flow for desktop apps.
 *
 * No external npm dependencies — uses Node built-ins:
 *   node:http, node:crypto, node:fs
 * Token storage uses Electron's safeStorage (OS keychain encryption).
 *
 * Setup: place a google-oauth.json file in userData with:
 *   { "clientId": "...", "clientSecret": "..." }
 * Or set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars (dev only).
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, shell, safeStorage } from 'electron';
import { getTokenPath } from '../paths';
import { logger } from '../logger';

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_PORT_RANGE = [49152, 65535] as const;

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix ms
}

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

function loadConfig(): OAuthConfig {
  // 1. Environment variables (dev convenience).
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }
  // 2. JSON config file in userData.
  const configPath = path.join(app.getPath('userData'), 'google-oauth.json');
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as OAuthConfig;
    if (raw.clientId && raw.clientSecret) return raw;
  }
  throw new Error(
    'Google OAuth credentials not found. ' +
    'Place google-oauth.json in the app data folder or set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.'
  );
}

// ---------------------------------------------------------------------------
// Token persistence via safeStorage (OS keychain encryption).
// ---------------------------------------------------------------------------
export function loadTokens(): OAuthTokens | null {
  const tokenPath = getTokenPath();
  if (!fs.existsSync(tokenPath)) return null;
  try {
    const encrypted = fs.readFileSync(tokenPath);
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(encrypted)
      : encrypted.toString('utf8');
    return JSON.parse(json) as OAuthTokens;
  } catch (err) {
    logger.warn('googleAuth: failed to load tokens', { err });
    return null;
  }
}

export function saveTokens(tokens: OAuthTokens): void {
  const tokenPath = getTokenPath();
  const json = JSON.stringify(tokens);
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8');
  fs.writeFileSync(tokenPath, data);
}

export function clearTokens(): void {
  const tokenPath = getTokenPath();
  if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
}

// ---------------------------------------------------------------------------
// Token refresh.
// ---------------------------------------------------------------------------
export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const config = loadConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000, // 1 min buffer
  };
}

/** Returns a valid access token, refreshing if necessary. */
export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Not authenticated with Google Drive.');
  if (Date.now() < tokens.expires_at) return tokens.access_token;
  const refreshed = await refreshAccessToken(tokens.refresh_token);
  saveTokens(refreshed);
  return refreshed.access_token;
}

// ---------------------------------------------------------------------------
// PKCE helpers.
// ---------------------------------------------------------------------------
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash.toString('base64url');
}

function pickPort(): number {
  const [min, max] = REDIRECT_PORT_RANGE;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Full PKCE loopback OAuth flow.
// ---------------------------------------------------------------------------
export async function authenticate(): Promise<OAuthTokens> {
  const config = loadConfig();
  const port = pickPort();
  const redirectUri = `http://127.0.0.1:${port}`;
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl =
    `${AUTH_URL}?` +
    new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    }).toString();

  // Start a one-shot local HTTP server to receive the OAuth redirect.
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const returnedState = url.searchParams.get('state');
      const returnedCode = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body style="font-family:sans-serif;padding:2rem">'
        + '<h2>Authentication complete</h2>'
        + '<p>You can close this tab and return to Restaurant POS.</p>'
        + '</body></html>'
      );
      server.close();

      if (error) { reject(new Error(`OAuth error: ${error}`)); return; }
      if (returnedState !== state) { reject(new Error('OAuth state mismatch.')); return; }
      if (!returnedCode) { reject(new Error('No authorization code received.')); return; }
      resolve(returnedCode);
    });

    server.listen(port, '127.0.0.1', () => {
      shell.openExternal(authUrl).catch(reject);
    });

    server.on('error', reject);

    // Timeout after 5 minutes. unref() so this timer does not keep the
    // process alive if the app is closed while the OAuth flow is open.
    const timeoutHandle = setTimeout(() => {
      try { server.close(); } catch { /* already closed by a successful redirect */ }
      reject(new Error('OAuth flow timed out. Please try again.'));
    }, 5 * 60 * 1000);
    timeoutHandle.unref();
  });

  // Exchange the authorization code for tokens.
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const tokens: OAuthTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000,
  };

  saveTokens(tokens);
  logger.info('googleAuth: authentication successful');
  return tokens;
}
