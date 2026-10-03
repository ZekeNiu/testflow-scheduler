(function(root){
  'use strict';
  // Populate the styled workbook template locally; no network or workbook library is needed at runtime.
  const xml=value=>String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const round=value=>Math.round(value*1000)/1000;
  const col=i=>String.fromCharCode(65+i);
  function peopleRange(people){
    const sorted=[...new Set(people)].sort((a,b)=>a-b),parts=[];
    for(let i=0;i<sorted.length;i++){const first=sorted[i];let last=first;while(sorted[i+1]===last+1)last=sorted[++i];parts.push(first===last?String(first).padStart(3,'0'):String(first).padStart(3,'0')+'–'+String(last).padStart(3,'0'));}
    return parts.join('、')+' 号';
  }
  const crcTable=Array.from({length:256},(_,i)=>{let value=i;for(let j=0;j<8;j++)value=value&1?0xEDB88320^(value>>>1):value>>>1;return value>>>0;});
  function crc32(bytes){let value=0xFFFFFFFF;for(const b of bytes)value=crcTable[(value^b)&255]^(value>>>8);return (value^0xFFFFFFFF)>>>0;}
  async function zip(parts){
    const enc=new TextEncoder(),locals=[],central=[];let offset=0,centralSize=0;
    for(const [path,content]of Object.entries(parts)){
      const name=enc.encode(path),raw=enc.encode(content),crc=crc32(raw);let data=raw,method=0;
      if(root.CompressionStream)try{const compressed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());if(compressed.length<raw.length){data=compressed;method=8;}}catch{/* Older browsers can still export a valid uncompressed workbook. */}
      const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);
      h.setUint32(0,0x04034B50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(8,method,true);h.setUint16(12,0x21,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,raw.length,true);h.setUint16(26,name.length,true);header.set(name,30);
      const entry=new Uint8Array(46+name.length),e=new DataView(entry.buffer);e.setUint32(0,0x02014B50,true);e.setUint16(4,20,true);e.setUint16(6,20,true);e.setUint16(8,0x800,true);e.setUint16(10,method,true);e.setUint16(14,0x21,true);e.setUint32(16,crc,true);e.setUint32(20,data.length,true);e.setUint32(24,raw.length,true);e.setUint16(28,name.length,true);e.setUint32(42,offset,true);entry.set(name,46);
      locals.push(header,data);central.push(entry);offset+=header.length+data.length;centralSize+=entry.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054B50,true);e.setUint16(8,central.length,true);e.setUint16(10,central.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
    const bytes=new Uint8Array(offset+centralSize+end.length);let position=0;for(const part of [...locals,...central,end]){bytes.set(part,position);position+=part.length;}return bytes;
  }
  async function build(calculation){
    const {config:c,result:r}=calculation;if(!r)throw new Error('请先修正方案参数');
    const template=root.TestFlowWorkbookTemplate,parts={...template.parts},styles=template.styles;
    const earliestArrival=r.earliestArrival??Math.min(...r.arrivalPlan.map(b=>b.report)),coverageStart=r.coverageStart??Math.min(0,earliestArrival),coverageEnd=r.coverageEnd??r.actual,coverageDuration=r.coverageDuration??round(coverageEnd-coverageStart);
    const waveTimes=[...new Set(r.arrivalPlan.map(b=>Math.round(b.report*1000)))].sort((a,b)=>a-b),arrivalWaveCount=r.arrivalWaveCount??waveTimes.length;
    const earliest=c.startMs===null?null:new Date(c.startMs+Math.round(coverageStart*1000)),latest=c.startMs===null?null:new Date(c.startMs+Math.round(coverageEnd*1000));
    const absolute=c.startMs!==null&&earliest.getFullYear()>=1900&&latest.getFullYear()<=9999;
    const timeValue=seconds=>{
      if(!absolute)return round(seconds);
      const date=new Date(c.startMs+Math.round(seconds*1000));
      const serial=Date.UTC(date.getFullYear(),date.getMonth(),date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds(),date.getMilliseconds())/86400000+25569;
      return serial<61?serial-1:serial;
    };
    const fractional=value=>Math.abs(value-Math.round(value))>.000001;
    const durationStyle=(seconds,metric=false)=>(metric?'metricDuration':'duration')+(fractional(round(seconds))?'Ms':'');
    const timeStyle=seconds=>absolute?(fractional(seconds)?'clockMs':'clock'):'elapsed';
    const data=(value,style='text',formula=null)=>({value,style,formula});
    const seconds=value=>data(round(value)/86400,durationStyle(value));
    const time=value=>data(timeValue(value),timeStyle(value));
    const number=value=>data(value,'number');
    const person=value=>data(value,'person');
    const bodyStyle=(style,parity)=>styles[style][parity];
    function cell(address,item,parity){
      if(item===null||item===undefined)return '';
      if(typeof item!=='object')item=data(item);
      const style=bodyStyle(item.style,parity),value=item.value;
      if(item.formula)return `<x:c r="${address}" s="${style}"><x:f>${xml(item.formula)}</x:f><x:v>${value}</x:v></x:c>`;
      if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('排程中出现无效数值');return `<x:c r="${address}" s="${style}"><x:v>${value}</x:v></x:c>`;}
      return `<x:c r="${address}" s="${style}" t="inlineStr"><x:is><x:t xml:space="preserve">${xml(value??'')}</x:t></x:is></x:c>`;
    }
    function row(index,values,{height=26,parity=0}={}){return `<x:row r="${index}" ht="${height}" customHeight="1">${values.map((item,i)=>cell(col(i)+index,item,parity)).join('')}</x:row>`;}
    const charWidth=text=>[...String(text)].reduce((sum,char)=>sum+(/[\u0000-\u00FF]/.test(char)?1:2),0);
    const fittedHeight=(text,width=28)=>Math.max(26,Math.ceil(charWidth(text)/width)*15+8);
    const table=(start,headers,rows,nameColumn=0)=>row(start,headers.map(value=>data(value,'heading')),{height:42})+rows.map((values,i)=>row(start+i+1,values,{parity:i%2,height:fittedHeight(values[nameColumn]?.value??values[nameColumn])})).join('');
    const context=`${c.n} 人完成 ${c.stations.length} 个站点，${c.mode}${c.groups?'，共 '+c.groups+' 组':''}，${c.arrivalMode==='auto'?'自动分批到场':'全体集中到场'}`;
    const timeNote=absolute?'时刻按当前设备本地日期和钟点显示。':(c.startMs===null?'':'日期超出 Excel 日期范围。')+'时刻为距全场开场的累计秒数，负数表示开场前。';
    const opening=(title,note)=>row(1,[],{height:10})+row(2,[data(title,'title')],{height:31})+row(3,[data(note,'context')],{height:24})+row(4,[],{height:9});
    function updateSheet(index,rows,lastCol,lastRow,tableStart,tableEnd,headers){
      const path=`xl/worksheets/sheet${index}.xml`,last=col(lastCol-1),range=`A${tableStart}:${last}${tableEnd}`;
      let source=parts[path].replace('{{ROWS}}',rows);
      source=source.replace(/<x:pageMargins\b[^>]*\/>/g,'');
      source=source.replace('<x:sheetViews>',`<x:dimension ref="A1:${last}${lastRow}"/><x:sheetViews>`);
      source=source.replace('</x:sheetPr>','<x:pageSetUpPr fitToPage="1"/></x:sheetPr>');
      source=source.replace('<x:tableParts',`<x:printOptions horizontalCentered="1"/><x:pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><x:pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/><x:tableParts`);
      parts[path]=source;
      const tablePath=`xl/tables/table${index}.xml`;let column=0;
      parts[tablePath]=parts[tablePath].replace(/ref="[^"]+"/g,`ref="${range}"`).replace(/(<x:tableColumn\b[^>]*\bname=")[^"]*(")/g,(_,before,after)=>before+xml(headers[column++])+after);
    }
    let overview=opening('测试排程',context);
    overview+=row(5,[data('关键指标','section'),data('数值','section'),null,data('现场安排','section'),data('时长','section')]);
    const labels=['开场至收尾时长','建议预留时间','人均累计等待时间','预计峰值等待人数'],values=[r.actual,r.reserved,r.meanWait,r.peakWaiting],phaseLabels=['开场准备','测试时段（含休息）','收尾','机动预留'],phaseValues=[c.prep,r.test,c.close,c.buffer];
    for(let i=0;i<4;i++)overview+=row(6+i,[data(labels[i],'label'),data(i===3?values[i]:round(values[i])/86400,i===3?'metricNumber':durationStyle(values[i],true)),null,data(phaseLabels[i],'label'),seconds(phaseValues[i])],{height:29});
    overview+=row(10,[data('最早到场','label'),null,null,time(earliestArrival)],{height:29});
    overview+=row(11,[data('收尾结束','label'),null,null,time(coverageEnd)],{height:29});
    overview+=row(12,[data('场地覆盖时长','label'),null,null,seconds(coverageDuration)],{height:29});
    overview+=row(14,[data(timeNote+' 场地覆盖从开场与最早到场中的较早时刻计至收尾结束，不含额外机动预留。','note')]);
    const statHeaders=['测试站点','可同时测试人数','峰值测试人数','首次开测时间','最后结束时间','工作时长','工位使用率','人均本站等待时间','最长本站等待时间','本站峰值等待人数','实际占用工位总时长'];
    // Local date cells preserve clock-face display; elapsed formulas use relative seconds across DST and Excel's 1900 leap-day boundary.
    const stats=r.stationStats.map((s,i)=>{const rr=17+i;return [data(String(s.slot).padStart(2,'0')+' '+s.name),number(s.capacity),number(s.peakTesting),time(r.testStart+s.first),time(r.testStart+s.last),data(round(s.workDuration)/86400,durationStyle(s.workDuration),`${round(s.workDuration)}/86400`),data(s.utilization,'percent',`K${rr}/(B${rr}*F${rr})`),seconds(s.meanWait),seconds(s.maxWait),number(s.peakQueue),seconds(s.occupiedPersonSeconds)];});
    overview+=table(16,statHeaders,stats);
    let rr=18+stats.length;
    overview+=row(rr++,[data('工位使用率 = 实际占用工位总时长 ÷（同时测试人数 × 工作时长）。整批测试按人数位置计算占用率。','note')]);
    overview+=row(rr++,[data('等待包含排队、凑批与统一换站等待，扣除整体休息，不包含转场、恢复及提前到场准备。','note')]);
    rr++;
    if(r.effectiveBreaks.length){
      overview+=row(rr++,[data('整体休息安排','section')]);
      const start=rr,breakRows=r.effectiveBreaks.map((b,i)=>[data(b.name),number(b.afterStage),seconds(b.end-b.start),time(b.start),time(b.end)]);
      overview+=table(start,['休息名称',c.mode==='分组轮转'?'第几轮全部完成后':'第几个启用站点全部完成后','休息时长','统一休息开始','统一休息结束'],breakRows);
      rr+=breakRows.length+2;
    }
    overview+=row(rr++,[data('站点设置','section')]);
    const stationSettings=c.stations.map(s=>[data(String(s.slot).padStart(2,'0')+' '+s.name),data(s.kind==='batch'?'整批测试':'独立工位'),number(s.cap),seconds(s.d),seconds(s.z),seconds(s.gapSec),data(s.kind==='batch'?(s.policy==='immediate'?'有人即开':'满批优先，尾批可不足'):'—')]);
    overview+=table(rr,['测试站点','测试方式','人数上限','完整测试耗时','复位时间','离站间隔','开批规则'],stationSettings);
    rr+=stationSettings.length+2;
    overview+=row(rr++,[data(`到场方式：${c.arrivalMode==='auto'?'自动分批到场':'全体集中到场'}。${c.arrivalMode==='auto'?'每批人数 '+(c.arrivalBatchSize||'按起始站点人数上限')+'，提前准备 '+round(c.arrivalLead)+' 秒。':''}`,'note')]);
    updateSheet(1,overview,11,rr-1,16,16+stats.length,statHeaders);
    const headers=['人员编号','小组','测试次序','站点编号','测试站点','工位或批次','最早可开测时间','计划开测时间','测试结束时间','测试时长','本站等待时间','期间整体休息时间'];
    function recordRows(records,stationOrder=false){return records.map(e=>{
      const s=c.stations[e.station-1],values=[person(e.person),e.group?number(e.group):data('—'),number(e.visit),number(s.slot),data(e.name),data((s.kind==='batch'?'批次 ':'工位 ')+e.unit),time(r.testStart+e.ready),time(r.testStart+e.begin),time(r.testStart+e.end),data(round(e.end-e.begin)/86400,durationStyle(e.end-e.begin),`${round(e.end-e.begin)}/86400`),seconds(e.wait),seconds(e.breakWait)];
      return stationOrder?[values[3],values[4],values[5],values[0],values[1],values[2],...values.slice(6)]:values;
    });}
    const peopleRecords=[...r.records].sort((a,b)=>a.person-b.person||a.visit-b.visit),stationRecords=[...r.records].sort((a,b)=>a.station-b.station||a.begin-b.begin||a.unit-b.unit||a.person-b.person);
    updateSheet(2,opening('人员排程','按人员编号和测试次序排序。'+timeNote)+table(5,headers,recordRows(peopleRecords),4),12,5+r.records.length,5,5+r.records.length,headers);
    const stationHeaders=['站点编号','测试站点','工位或批次','人员编号','小组','测试次序',...headers.slice(6)];
    updateSheet(3,opening('站点排程','按站点、开测时间和工位排序。'+timeNote)+table(5,stationHeaders,recordRows(stationRecords,true),1),12,5+r.records.length,5,5+r.records.length,stationHeaders);
    const arrivalRows=[...r.arrivalPlan].sort((a,b)=>a.report-b.report||a.batch-b.batch).map(b=>[number(b.wave??waveTimes.indexOf(Math.round(b.report*1000))+1),data(peopleRange(b.people)+'（接待组 '+b.batch+'）'),number(b.count),b.group?number(b.group):data('—'),data(c.stations[b.station-1].name),time(b.report),time(b.ready),time(b.firstBegin),time(b.lastBegin)]);
    const arrivalHeaders=['到场波次','人员编号范围 / 接待组','到场人数','所属小组','起始站点','建议到场时间','首站就位时间','本组首次开测时间','本组最后开测时间'];
    updateSheet(4,opening('到场安排',`${c.arrivalMode==='auto'?'自动分批到场，提前准备 '+round(c.arrivalLead)+' 秒。':'全体集中到场。'}共 ${arrivalWaveCount} 个到场波次 / ${arrivalRows.length} 个接待组；同刻的接待组计为一波。${timeNote}`)+table(5,arrivalHeaders,arrivalRows,4),9,5+arrivalRows.length,5,5+arrivalRows.length,arrivalHeaders);
    const printNames=['排程总览','人员排程','站点排程','到场安排'];
    let definitions='';for(let i=1;i<4;i++)definitions+=`<x:definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${printNames[i]}'!$1:$5</x:definedName>`;
    parts['xl/workbook.xml']=parts['xl/workbook.xml'].replace('</x:workbook>',`<x:definedNames>${definitions}</x:definedNames></x:workbook>`);
    return zip(parts);
  }
  const api={build};root.TestFlowExport=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
