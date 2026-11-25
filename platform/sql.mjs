/** SQLite dump lexer: comments, quoted semicolons and trigger BEGIN/CASE/END. */
export function splitSql(input) {
  const out=[];let start=0,word='',tokens=[],depth=0,trigger=false,quote=null,comment=null;
  const token=()=>{if(!word)return;const t=word.toUpperCase();tokens.push(t);if(tokens[0]==='CREATE'&&tokens.slice(0,4).includes('TRIGGER'))trigger=true;if(trigger){if(t==='BEGIN'||t==='CASE')depth++;if(t==='END')depth--;}word='';};
  for(let i=0;i<input.length;i++){
    const c=input[i],next=input[i+1];
    if(comment==='line'){if(c==='\n')comment=null;continue;}
    if(comment==='block'){if(c==='*'&&next==='/'){comment=null;i++;}continue;}
    if(quote){const end=quote==='['?']':quote;if(c===end){if(next===end){i++;continue;}quote=null;}continue;}
    if(c==='-'&&next==='-'){token();comment='line';i++;continue;}
    if(c==='/'&&next==='*'){token();comment='block';i++;continue;}
    if(['\'', '"','`','['].includes(c)){token();quote=c;continue;}
    if(/[A-Za-z0-9_]/.test(c)){word+=c;continue;}token();
    if(c===';'&&(!trigger||depth===0)){
      const statement=input.slice(start,i+1).trim();if(tokens.length)out.push(statement);
      start=i+1;tokens=[];trigger=false;depth=0;
    }
  }
  token();
  const remaining=input.slice(start).replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g,'').trim();
  if(quote||comment==='block'||depth!==0||remaining)throw Error('Incomplete SQL statement');
  return out;
}
export const stripComments=sql=>sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/,'').trim();
const identifier='("(?:[^"]|"")*"|`[^`]*`|\\[[^\\]]*\\]|[A-Za-z_][A-Za-z0-9_]*)';
export function statementInfo(sql) {
  const value=stripComments(sql);
  if(/^(?:BEGIN|COMMIT|END|ROLLBACK|PRAGMA|ANALYZE)\b/i.test(value))return {kind:'control'};
  const patterns=[['view',new RegExp('^CREATE\\s+VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'+identifier,'i')],['table',new RegExp('^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'+identifier,'i')],['data',new RegExp('^(?:INSERT(?:\\s+OR\\s+\\w+)?|REPLACE)\\s+INTO\\s+'+identifier,'i')],['index',new RegExp('^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'+identifier+'\\s+ON\\s+'+identifier,'i')],['trigger',new RegExp('^CREATE\\s+TRIGGER\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'+identifier+'[\\s\\S]*?\\sON\\s+'+identifier,'i')]];
  for(const [kind,pattern] of patterns){const m=pattern.exec(value);if(m){const name=m[kind==='index'||kind==='trigger'?2:1].replace(/^['"`\[]|['"`\]]$/g,'').replaceAll('""','"');return {kind,table:name,internal:/^(?:_cf_|sqlite_|d1_migrations$)/i.test(name)};}}
  throw Error('Unsupported SQL in D1 dump; no statement was executed');
}
export const quoteIdentifier=name=>'"'+name.replaceAll('"','""')+'"';
export function sqlValue(value) {
  if(value===null)return 'NULL';if(typeof value==='bigint')return String(value);
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Nonfinite SQL number');return String(value);}
  if(value instanceof Uint8Array)return "X'"+Buffer.from(value).toString('hex')+"'";
  if(typeof value==='string')return value.includes('\0')?"CAST(X'"+Buffer.from(value).toString('hex')+"' AS TEXT)":"'"+value.replaceAll("'","''")+"'";
  throw Error('Unsupported SQLite value');
}
