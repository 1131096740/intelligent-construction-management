// Deliberately bounded COS metadata subset. Unsupported XML fails closed.
export function parseCosXml(text,expectedRoot){
 if(typeof text!=='string'||Buffer.byteLength(text)>4194304||/<!|<\w+:/.test(text))throw Error('unsupported COS XML');
 const xml=text.trim().replace(/^<\?xml\s+[^?]*\?>\s*/,''),stack=[];let root,offset=0,nodes=0;
 for(const match of xml.matchAll(/<([^>]+)>/g)){
  const value=xml.slice(offset,match.index);if(/[<>]/.test(value))throw Error('incomplete COS XML');if(stack.length)stack.at(-1).text+=value;else if(value.trim())throw Error('text outside COS document');
  offset=match.index+match[0].length;let token=match[1];
  if(token.startsWith('/')){if(!/^\/[A-Za-z][A-Za-z0-9]*$/.test(token)||!stack.length||stack.pop().name!==token.slice(1))throw Error('unbalanced COS XML');continue;}
  const selfClosing=token.endsWith('/');if(selfClosing)token=token.slice(0,-1).trim();
  const tag=token.match(/^([A-Za-z][A-Za-z0-9]*)(?:\s+xmlns="https?:\/\/[^"<>\s]+")?$/);
  if(!tag||token!==tag[1]&&stack.length||++nodes>20000||stack.length>20)throw Error('unsupported COS XML node');
  const node={name:tag[1],text:'',children:[]};if(stack.length)stack.at(-1).children.push(node);else{if(root)throw Error('multiple COS XML roots');root=node;}
  if(!selfClosing)stack.push(node);
 }
 if(stack.length||xml.slice(offset).trim()||root?.name!==expectedRoot)throw Error('incomplete COS XML root');return root;
}
export const children=(node,name)=>node.children.filter(n=>n.name===name);
export function decodeCosXmlText(text){
 if(/&(?!amp;|lt;|gt;|quot;|apos;|#(?:[0-9]+|x[0-9A-Fa-f]+);)/.test(text))throw Error('unknown COS XML entity');
 const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
 return text.replace(/&([^;]+);/g,(_match,name)=>{
  if(Object.hasOwn(named,name))return named[name];
  const n=name.startsWith('#x')?Number.parseInt(name.slice(2),16):Number(name.slice(1));
  if(!Number.isSafeInteger(n)||n<0x20&&!([9,10,13].includes(n))||n>0x10ffff||n>=0xd800&&n<=0xdfff||n===0xfffe||n===0xffff)throw Error('invalid COS XML character');
  return String.fromCodePoint(n);
 });
}
export function singleText(node,name,trim=true){const found=children(node,name);if(found.length!==1||found[0].children.length)throw Error('ambiguous COS XML field');const text=decodeCosXmlText(found[0].text);return trim?text.trim():text;}

