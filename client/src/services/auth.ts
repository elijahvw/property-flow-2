import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession
} from 'amazon-cognito-identity-js';

let userPool: CognitoUserPool | null = null;

const getUserPool = () => {
  if (userPool) return userPool;
  
  const poolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  
  if (!poolId || !clientId) {
    console.error('Cognito Configuration Missing');
    return null;
  }
  
  userPool = new CognitoUserPool({
    UserPoolId: poolId,
    ClientId: clientId
  });
  return userPool;
};

export const AuthService = {
  getSession: (): Promise<CognitoUserSession | null> => {
    return new Promise((resolve) => {
      const pool = getUserPool();
      if (!pool) return resolve(null);
      
      const user = pool.getCurrentUser();
      if (!user) return resolve(null);
      
      user.getSession((err: any, session: CognitoUserSession) => {
        if (err) resolve(null);
        else resolve(session);
      });
    });
  },

  logout: () => {
    const pool = getUserPool();
    const user = pool?.getCurrentUser();
    if (user) {
      user.signOut();
      localStorage.removeItem('access_token');
      window.location.reload();
    }
  },

  getToken: async () => {
    const session = await AuthService.getSession();
    if (session) return session.getIdToken().getJwtToken();
    return localStorage.getItem('access_token');
  }
};
