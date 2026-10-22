// EXPORTS: AppDataContext, useAppData, IAppDataApi
import { createContext, useContext } from 'react';
import type { IAppData } from './types';

export interface IAuthUser {
  username: string;
  name: string;
}

export interface IAppDataApi {
  data: IAppData;
  setData: (updater: (prev: IAppData) => IAppData) => void;
  authUser: IAuthUser | null;
  login: (username: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  register: (username: string, password: string, name: string) => Promise<boolean>;
  logout: () => void;
  refresh: () => Promise<boolean>;
}

export const AppDataContext = createContext<IAppDataApi | null>(null);

export function useAppData(): IAppDataApi {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppProvider');
  return ctx;
}
