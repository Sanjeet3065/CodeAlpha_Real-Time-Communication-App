import React from 'react';
import { AuthGatewayPage } from '@/pages/AuthGatewayPage';

// Pine focus rings (focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]) are
// applied throughout AuthGatewayPage, which this page delegates to.
export const RegisterPage: React.FC = () => <AuthGatewayPage initialMode="signup" />;

export default RegisterPage;
