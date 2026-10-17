// Test-only identities for fictional local seed accounts. No real provider calls.
import {createHash} from 'node:crypto';
export async function fixtureIdentities(admin,calls=[]) {
 await admin.query(`
 CREATE FUNCTION fixture_signin_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.id NOT LIKE 'auth0|%' THEN INSERT INTO "Identity"(id,issuer,subject,"userId") VALUES('fixture-'||NEW.id,'https://unused.auth0.com/',NEW.id,NEW.id) ON CONFLICT DO NOTHING; END IF;
 RETURN NEW; END $$;
 CREATE TRIGGER fixture_identity AFTER INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION fixture_signin_identity();
 INSERT INTO "Identity"(id,issuer,subject,"userId") SELECT 'fixture-'||id,'https://unused.auth0.com/',id,id FROM "User" WHERE id NOT LIKE 'auth0|%' ON CONFLICT DO NOTHING;
 `);
 const remote=new Map();
 const profile=row=>({user_id:row.id,email:row.email,name:row.name,email_verified:row.emailVerified,identities:[{connection:'Username-Password-Authentication',provider:'auth0'}]});
 const provider={issuer:'https://unused.auth0.com/',databaseConnection:'Username-Password-Authentication',
 async get(id){calls.push(['get',id]);const existing=(await admin.query('SELECT * FROM "User" WHERE id=$1',[id])).rows[0];const row=existing?profile(existing):remote.get(id);if(!row)throw Error('fixture account missing');return row;},
 async create(email,name){calls.push(['create',email,name]);const existing=(await admin.query('SELECT * FROM "User" WHERE lower(email)=lower($1)',[email])).rows[0];if(existing)return profile(existing);const id='auth0|'+createHash('sha256').update(email).digest('hex').slice(0,24);if(!remote.has(id))remote.set(id,{...profile({id,email,name,emailVerified:false})});return remote.get(id);},
 async rename(id,name){calls.push(["rename",id,name]);const row=await provider.get(id);row.name=name;remote.set(id,row);return row;},
 async list(){return {users:[],nextPage:null};},
 async setup(email){calls.push(['setup',email]);},async verify(id){calls.push(['verify',id]);}};
 return provider;
}
