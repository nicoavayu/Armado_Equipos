// SQL lexical splitter: comments, quoted identifiers, strings and dollar bodies
// are kept intact. Only top-level transaction delimiters are removed for the
// local single-transaction runner; source migration bytes are never edited.
export function statements(source) {
  const out = []; let start = 0, i = 0, quote = '', dollar = '', block = 0, line = false;
  while (i < source.length) {
    const c=source[i], next=source[i+1];
    if(line){if(c==='\n')line=false;i++;continue;}
    if(block){if(c==='/'&&next==='*'){block++;i+=2;}else if(c==='*'&&next==='/'){block--;i+=2;}else i++;continue;}
    if(dollar){if(source.startsWith(dollar,i)){i+=dollar.length;dollar='';}else i++;continue;}
    if(quote){if(c===quote){if(next===quote)i+=2;else{quote='';i++;}}else if(c==='\\'&&quote==="'"&&source[i+1]==="'"){i+=2;}else i++;continue;}
    if(c==='-'&&next==='-'){line=true;i+=2;continue;}
    if(c==='/'&&next==='*'){block=1;i+=2;continue;}
    if(c==="'"||c==='"'){quote=c;i++;continue;}
    if(c==='$'){const m=source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);if(m){dollar=m[0];i+=dollar.length;continue;}}
    if(c===';'){out.push(source.slice(start,i+1));start=i+1;}i++;
  }
  if(quote||dollar||block)throw new Error('Unterminated SQL lexical state');
  if(source.slice(start).trim())out.push(source.slice(start));
  return out;
}
export const bare = s => s.replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g,' ').trim();
