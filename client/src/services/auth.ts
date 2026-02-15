import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession
} from 'amazon-cognito-identity-js';

const poolData = {
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || ''
};

const userPool = new CognitoUserPool(poolData);

export const AuthService = {
  getSession: (): Promise<CognitoUserSession | null> => {
    return new Promise((resolve) => {
      const user = userPool.getCurrentUser();
      if (!user) return resolve(null);
      user.getSession((err: any, session: CognitoUserSession) => {
        if (err) resolve(null);
        else resolve(session);
      });
    });
  },

  logout: () => {
    const user = userPool.getCurrentUser();
    if (user) {
      user.signOut();
      localStorage.removeItem('access_token');
      window.location.reload();
    }
  },

  getToken: async () => {
    const session = await AuthService.getSession();
    if (session) return session.getAccessToken().getJwtToken();
    return localStorage.getItem('access_token');
  }
};
