'use strict';

// Reserved Perl exit statuses carry only a direction and a fixed errno class.
const errnos=Object.freeze(['ECONNRESET','ENOTCONN','OTHER']);

function decodeRelaySysreadExit(exit){
  if(!Number.isInteger(exit)||exit<70||exit>75)return undefined;
  return {relaySysreadDirection:exit<73?'PG':'STDIN',relaySysreadErrno:errnos[(exit-70)%3]};
}

module.exports=Object.freeze({decodeRelaySysreadExit});
