import guide from '../../docs/guide.md?raw';

const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function inline(text:string):string {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/).map(token=>{
    if(token.startsWith('`')) return '<code>'+esc(token.slice(1,-1).replace(/\\\|/g,'|'))+'</code>';
    if(token.startsWith('**'))return '<strong>'+esc(token.slice(2,-2))+'</strong>';
    const link=/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(token);
    if(link)return `<a href="${esc(link[2])}" target="_blank" rel="noreferrer">${esc(link[1])}</a>`;
    return esc(token);
  }).join('');
}
function tableCells(line:string):string[] {
  return line.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(c=>c.trim());
}
/** Deliberately small renderer for the repository-owned guide; raw HTML is always escaped. */
function render(markdown:string):string {
  const lines=markdown.trim().split('\n'), out:string[]=[];
  for(let i=0;i<lines.length;) {
    const line=lines[i];
    if(!line.trim()){i++;continue;}
    if(line.startsWith('```')) {
      const block:string[]=[];i++;while(i<lines.length&&!lines[i].startsWith('```'))block.push(lines[i++]);i++;
      out.push('<pre class="guide-pre">'+esc(block.join('\n'))+'</pre>');continue;
    }
    if(line.startsWith('|')) {
      const rows:string[][]=[];while(i<lines.length&&lines[i].startsWith('|'))rows.push(tableCells(lines[i++]));
      out.push('<table class="guide-table"><thead><tr>'+rows[0].map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.slice(2).map(row=>'<tr>'+row.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>');continue;
    }
    const heading=/^### (.*)$/.exec(line);if(heading){out.push('<h4>'+inline(heading[1])+'</h4>');i++;continue;}
    if(/^\d+\. /.test(line)){
      const items:string[]=[];while(i<lines.length&&/^\d+\. /.test(lines[i]))items.push(lines[i++].replace(/^\d+\. /,''));
      out.push('<ol>'+items.map(s=>'<li>'+inline(s)+'</li>').join('')+'</ol>');continue;
    }
    const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(?:```|\||### |\d+\. )/.test(lines[i]))paragraph.push(lines[i++]);
    out.push('<p>'+inline(paragraph.join(' '))+'</p>');
  }
  return out.join('\n');
}
export const GUIDE=guide.split(/^## /m).slice(1).map((section,i)=>{
  const newline=section.indexOf('\n'),title=section.slice(0,newline);
  const html=render(section.slice(newline+1));
  return {id:'guide-'+i,title,body:()=> <div dangerouslySetInnerHTML={{__html:html}}/>};
});
