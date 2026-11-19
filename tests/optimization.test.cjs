const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8');
function setup() {
  const nodes = new Map();
  const node = () => ({ _value: '', get value() { return this._value; }, set value(v) { this._value = String(v); }, checked: false, disabled: false, hidden: false, textContent: '',
    listeners: {}, attributes: {}, classes: new Set(),
    get valueAsNumber() { return Number(this.value); },
    setAttribute(k,v) { this.attributes[k] = v; },
    addEventListener(k,fn) { this.listeners[k] = fn; },
    fire(k, event = {}) { this.listeners[k]?.({ preventDefault() {}, target: this, ...event }); },
    reportValidity() { return true; }, contains() { return false; },
    replaceChildren() {}, add() {}, focus() {},
  });
  const get = id => {
    if (!nodes.has(id)) {
      const n = node();
      n.classList = { toggle: (key,on) => on ? n.classes.add(key) : n.classes.delete(key) };
      nodes.set(id,n);
    }
    return nodes.get(id);
  };
  const fields = ['pitch','width','gap','count','offset','turn','diagonalLead','fabricWidth','fabricHeight'];
  const continuationFields = ['adjustLead','reverseLead','skipRows','reduceGap','extraBend','retryRoute'];
  const controls = get('#controls');
  controls.elements = Object.fromEntries([...fields,...continuationFields].map(f => [f,node()]));
  for (const f of continuationFields) controls.elements[f].type = 'checkbox';
  for (const [f,v] of Object.entries({pitch:2,width:4,gap:1,count:10,offset:0,turn:'sharp',diagonalLead:0,fabricWidth:6,fabricHeight:12})) controls.elements[f].value = String(v);
  const optimize = get('#optimize-controls');
  optimize.elements = Object.fromEntries(['samples','wrappedScoring',...['coverage','alignment','proximity','spectral','triangleEntropy'].map(f=>f+'Weight')].map(f=>[f,node()]));
  optimize.elements.samples.value = '2';
  for (const f in optimize.elements) if (f.endsWith('Weight')) optimize.elements[f].value = '1';
  optimize.querySelector = () => get('run');
  const context = vm.createContext({document:{querySelector:get},controls,continuationFields,
    presetFields:fields.filter(f=>!f.startsWith('fabric')).concat(continuationFields),
    presetList:get('#preset-list'),presetName:get('#preset-name'),presetStatus:get('#preset-status'),
    presets:new Map(),preview:node(),download:node(),Option:function(){},
    inches:{format:String},render(){},layout(){},diagonalLayout(){},fabricOffset(){},blendRanks(){},searchLayouts(){},
    Blob, URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},
    Worker:class { constructor(){context.lastWorker=this;} postMessage(){} terminate(){this.terminated=true;} },
    setTimeout,clearTimeout,
  });
  const functions = html.slice(html.indexOf('  function updatePresetList('),html.indexOf('  function blendRanks('));
  const handlers = html.slice(html.indexOf("  const optimize = document.querySelector"),html.indexOf('  const firstPreset ='));
  vm.runInContext(functions + handlers,context);
  const run = code => vm.runInContext(code,context);
  function generate(widths=[3,5]) {
    optimize.fire('submit');
    const terms=['combined','coverage','alignment','proximity','spectral','triangleEntropy'];
    const orders=Object.fromEntries(terms.map(t=>[t,widths.map((_,i)=>i)]));
    const ranks=Object.fromEntries(terms.map(t=>[t,widths.map((_,i)=>i/2)]));
    const records=[new Float64Array(widths.flatMap(w=>[w,1,.25,0,0,0]))];
    context.lastWorker.onmessage({data:{checked:widths.length,fits:widths.length,progress:1,done:true,
      results:{orders,ranks,records,blockSize:10,recordSize:6,fallbackFields:continuationFields.filter(field => field !== 'retryRoute')}}});
  }
  return {get,controls,context,run,generate};
}
test('slider applies immediately and Save preset captures the active result',()=>{
  const {get,controls,run,generate}=setup(); generate();
  assert.equal(controls.elements.width.value,'5');
  get('#rank-slider').value='0'; get('#rank-slider').fire('input');
  assert.equal(controls.elements.width.value,'3');
  get('#preset-name').value='Slider'; get('#save-preset').fire('click');
  assert.equal(run("presets.get('Slider').width"),'3');
  assert.equal(get('#rank-state').textContent,'');
  assert.equal(get('#rank-slider').classes.has('modified'),false);
});
test('manual edits and presets preserve results and position; same-position click resumes',()=>{
  const {get,controls,run,generate}=setup(); generate();
  const results=run('rankedLayouts');
  controls.elements.pitch.value='9'; controls.fire('input');
  assert.equal(run('rankedLayouts'),results);
  assert.equal(get('#rank-slider').value,'1');
  assert.equal(get('#rank-state').textContent,'Settings modified · Move slider to resume');
  get('#preset-name').value='Edited'; get('#save-preset').fire('click');
  get('#rank-slider').fire('click');
  assert.equal(controls.elements.pitch.value,'2');
  get('#preset-list').value='Edited'; get('#preset-list').fire('change');
  assert.equal(run('rankedLayouts'),results);
  assert.equal(get('#rank-slider').value,'1');
  assert.equal(get('#rank-slider').classes.has('modified'),true);
  get('#rank-slider').fire('click');
  assert.equal(controls.elements.pitch.value,'2');
  assert.equal(get('#rank-slider').classes.has('modified'),false);
  controls.elements.width.value='8'; controls.fire('input');
  controls.elements.width.value='5'; controls.fire('input');
  assert.equal(get('#rank-slider').classes.has('modified'),false);
});
test('new search replaces ranked results and a single result remains interactive',()=>{
  const {get,run,generate}=setup(); generate(); const previous=run('rankedLayouts');
  generate([4]);
  assert.notEqual(run('rankedLayouts'),previous);
  assert.equal(get('#rank-slider').max,'0');
  assert.equal(get('#rank-slider').disabled,false);
});
test('default weights and removal of Apply button',()=>{
  for(const [term,value] of Object.entries({coverage:1,alignment:0,proximity:1,spectral:1,triangleEntropy:1})) {
    assert.match(html,new RegExp(`name="${term}Weight"[^>]*value="${value}"`));
  }
  assert.doesNotMatch(html,/optimize-apply/);
  new vm.Script(html.slice(html.indexOf("  'use strict';"), html.lastIndexOf('</script>')));
});

test('reblending reapplies the selected position and clears modified settings',()=>{
  const {get,controls,context,run,generate}=setup(); generate();
  controls.elements.fabricWidth.value='20'; controls.fire('input');
  context.lastWorker.onmessage({data:{revision:run('blendRevision'),blend:{order:[1,0],scores:[1,0]}}});
  assert.equal(get('#rank-slider').value,'1');
  assert.equal(controls.elements.fabricWidth.value,'6');
  assert.equal(controls.elements.width.value,'3');
  assert.equal(get('#rank-slider').classes.has('modified'),false);
});
