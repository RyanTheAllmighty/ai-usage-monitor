import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { App } from './App';

import './styles.css';

const queryClient = new QueryClient();

const bootDelayMs = Number(import.meta.env.VITE_BOOT_DELAY_MS ?? 0);

setTimeout(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <QueryClientProvider client={queryClient}>
                <App />
            </QueryClientProvider>
        </React.StrictMode>,
    );
}, bootDelayMs);
