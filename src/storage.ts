import { useEffect, useRef, useState } from 'react';
import type { Game } from './core/model';
const DB = 'werewolf-local-v1';
export async function readLocal<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('data');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction('data');
      const req = tx.objectStore('data').get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    };
  });
}
export async function writeLocal(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('data');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction('data', 'readwrite');
      tx.objectStore('data').put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export interface Session {
  code: string;
  token: string;
}
export function useRoom(
  session: Session | undefined,
  onState: (data: unknown) => void,
  onError: (s: string) => void,
) {
  const [status, setStatus] = useState('未连接'),
    [pending, setPending] = useState(false),
    [result, setResult] = useState<Record<string, unknown>>({});
  const socket = useRef<WebSocket | undefined>(undefined);
  const callbacks = useRef({ onState, onError });
  callbacks.current = { onState, onError };
  useEffect(() => {
    if (!session) return;
    let stopped = false,
      retry: ReturnType<typeof setTimeout>,
      attempt = 0;
    const connect = () => {
      setStatus(attempt ? '正在重连' : '正在连接');
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/rooms/${session.code}/socket`,
      );
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'auth', token: session.token }));
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'state') {
          setStatus('已连接');
          callbacks.current.onState(m.state);
        }
        if (m.type === 'ack') {
          setPending(false);
          setResult(m.result ?? {});
        }
        if (m.type === 'error') {
          setPending(false);
          callbacks.current.onError(m.error);
        }
      };
      ws.onclose = (e) => {
        setPending(false);
        if (stopped) return;
        if (e.code === 4001) {
          setStatus('已在其他页面恢复，请关闭本页');
          return;
        }
        setStatus('连接中断，正在重连');
        retry = setTimeout(connect, Math.min(10000, 1000 * 2 ** attempt++));
      };
      ws.onerror = () => setStatus('连接失败');
    };
    const online = () => {
      clearTimeout(retry);
      socket.current?.close();
    };
    window.addEventListener('online', online);
    connect();
    return () => {
      stopped = true;
      window.removeEventListener('online', online);
      clearTimeout(retry);
      socket.current?.close();
    };
  }, [session?.code, session?.token]);
  function send(type: string, payload: Record<string, unknown> = {}) {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      onError('连接尚未恢复');
      return;
    }
    setPending(true);
    socket.current.send(JSON.stringify({ id: crypto.randomUUID(), type, payload }));
  }
  return { status, pending, result, send };
}
export function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return now;
}
export function compatible(value: unknown): value is Game {
  return (
    !!value &&
    typeof value === 'object' &&
    'format' in value &&
    value.format === 1 &&
    'players' in value &&
    'events' in value
  );
}
