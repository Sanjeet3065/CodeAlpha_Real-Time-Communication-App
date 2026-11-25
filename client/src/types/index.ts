import { ReactNode } from 'react';

/**
 * Common base props for layout and UI components
 */
export interface BaseComponentProps {
  className?: string;
  children?: ReactNode;
  id?: string;
}

/**
 * Standard button variants adhering to COMPONENT_LIBRARY_SPECIFICATION.md
 */
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'destructive'
  | 'outline'
  | 'icon'
  | 'fab'
  | 'dock';

/**
 * Standard button sizes
 */
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Badge status variants
 */
export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'host' | 'co-host';

/**
 * Card surface variants
 */
export type CardVariant = 'standard' | 'elevated' | 'theater';

/**
 * Container maximum width options
 */
export type ContainerSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

/**
 * Application environment configuration
 */
export interface AppConfig {
  appName: string;
  appUrl: string;
  apiBaseUrl: string;
  liveKitWsUrl: string;
  socketIoUrl: string;
  features: {
    virtualBackground: boolean;
    whiteboard: boolean;
    fileSharing: boolean;
  };
}

export * from './chat';
