const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const original = childProcess.spawnSync;
// Target adapter ONLY: the existing audit assertions remain untouched.
// Never invoke `supabase status`, which could discover the unrelated QA stack.
childProcess.spawnSync = (cmd,args,options) => {
  if(cmd==='npx' && JSON.stringify(args)===JSON.stringify(['supabase','status','-o','env'])) {
    return {status:0,stdout:'DB_URL="postgresql://postgres@127.0.0.1:58332/postgres"\n',stderr:''};
  }
  throw new Error('Unapproved subprocess from isolated audit: '+cmd+' '+JSON.stringify(args));
};
syncBuiltinESMExports();
