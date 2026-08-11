import {Socket} from 'node:net';

const original=Socket.prototype.setTypeOfService;
if(process.platform==='darwin' && typeof original==='function'){
  let count=0;
  Socket.prototype.setTypeOfService=function(value,...rest){
    count++;
    if(value===0 || value==null){
      process.stderr.write(`[CTW_UNDICI_TOS_PRELOAD] pid=${process.pid} call=${count} skipped-default value=${String(value)}\n`);
      return this;
    }
    try{
      return original.call(this,value,...rest);
    }catch(error){
      if(error?.code==='EINVAL'){
        process.stderr.write(`[CTW_UNDICI_TOS_PRELOAD] pid=${process.pid} call=${count} ignored-EINVAL value=${String(value)}\n`);
        return this;
      }
      throw error;
    }
  };
  process.stderr.write(`[CTW_UNDICI_TOS_PRELOAD] installed pid=${process.pid}\n`);
}
