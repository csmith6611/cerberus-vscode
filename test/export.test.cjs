const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {readManifest} = require('../dist/tokens');
test('exports a real Panda config with preset inheritance and local override', async () => {
  const dir=await fs.mkdtemp(path.join(__dirname,'panda-fixture-'));
  try {
    const file=path.join(dir,'panda.config.cjs');
    await fs.writeFile(file, `module.exports={eject:true,presets:[{name:'fixture',themes:{elysium:{tokens:{colors:{brand:{value:'#0ff'}}}}},theme:{tokens:{colors:{brand:{value:'#00f'}}},semanticTokens:{colors:{'page':{bg:{value:{base:'{colors.brand}',_dark:'#000'},description:'Page background'}}}}}}],theme:{extend:{tokens:{colors:{brand:{value:'#f00'}}}}}}`);
    execFileSync(process.execPath,[path.resolve(__dirname,'../scripts/export-tokens.cjs'),'--cwd',dir,'--config',file],{stdio:'pipe'});
    const manifest=readManifest(await fs.readFile(path.join(dir,'cerberus.tokens.json'),'utf8'));
    assert.equal(manifest.tokens.find(t=>t.name==='colors.brand').value,'#f00');
    const bg=manifest.tokens.find(t=>t.name==='colors.page.bg');
    assert.equal(bg.semantic,true); assert.equal(bg.description,'Page background');
    assert.equal(bg.value._dark,'#000');
    assert.equal(manifest.themes.elysium.find(t=>t.name==='colors.brand').value,'#0ff');
    assert.equal(manifest.tokens.find(t=>t.name==='colors.brand').cssVar,'--colors-brand');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('loads @pandacss/node through @pandacss/dev when it is not hoisted (pnpm layout)', async () => {
  const os=require('node:os');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cerberus-pnpm-'));
  try {
    const dev=path.join(dir,'node_modules/@pandacss/dev');
    await fs.mkdir(path.join(dev,'node_modules/@pandacss'),{recursive:true});
    await fs.writeFile(path.join(dev,'package.json'),'{"name":"@pandacss/dev","main":"index.js"}');
    await fs.writeFile(path.join(dev,'index.js'),'');
    await fs.symlink(path.resolve(__dirname,'../node_modules/@pandacss/node'),path.join(dev,'node_modules/@pandacss/node'),'dir');
    await fs.writeFile(path.join(dir,'panda.config.ts'),`export default {theme:{tokens:{colors:{brand:{value:'#0f0'}}}}}`);
    const out=path.join(dir,'out.json');
    execFileSync(process.execPath,[path.resolve(__dirname,'../scripts/export-tokens.cjs'),'--cwd',dir,'--config',path.join(dir,'panda.config.ts'),'--out',out],{stdio:'pipe',cwd:dir,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
    assert.equal(readManifest(await fs.readFile(out,'utf8')).tokens.find(t=>t.name==='colors.brand').value,'#0f0');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('Panda v2: loads @pandacss/dev/node loadConfig with presets, themes and a TS config', async () => {
  const os=require('node:os');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cerberus-panda2-'));
  try {
    await fs.mkdir(path.join(dir,'node_modules/@pandacss'),{recursive:true});
    await fs.symlink(path.resolve(__dirname,'../node_modules/@pandacss/dev-v2'),path.join(dir,'node_modules/@pandacss/dev'),'dir');
    await fs.writeFile(path.join(dir,'package.json'),'{"name":"fixture","private":true}');
    await fs.writeFile(path.join(dir,'panda.config.ts'),`export default {presets:[{name:'elysium',themes:{elysium:{tokens:{colors:{brand:{value:'#0ff'}}}}},theme:{tokens:{colors:{brand:{value:'#00f'}}},semanticTokens:{colors:{bg:{DEFAULT:{value:{base:'{colors.brand}',_darkMode:'#000'},description:'Default bg'}},page:{bg:{initial:{value:'{colors.bg}',deprecated:'Use bg'}}}}}}}],theme:{extend:{tokens:{colors:{red:{value:'#c00'}},spacing:{1:{value:'0.25rem'}}},recipes:{badge:{className:'badge',variants:{size:{sm:{},lg:{}}},defaultVariants:{size:'sm'}}}}}}`);
    const out=path.join(dir,'out.json');
    execFileSync(process.execPath,[path.resolve(__dirname,'../scripts/export-tokens.cjs'),'--cwd',dir,'--config',path.join(dir,'panda.config.ts'),'--out',out],{stdio:'pipe',cwd:dir,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
    const manifest=readManifest(await fs.readFile(out,'utf8'));
    const bg=manifest.tokens.find(t=>t.name==='colors.bg');
    assert.deepEqual([bg.semantic,bg.description,bg.value._darkMode],[true,'Default bg','#000']);
    assert.equal(manifest.tokens.find(t=>t.name==='colors.red').value,'#c00');
    assert.equal(manifest.tokens.find(t=>t.name==='colors.page.bg.initial').deprecated,'Use bg');
    assert.equal(manifest.themes.elysium.find(t=>t.name==='colors.brand').value,'#0ff');
    // Derived negative spacing exists only in the compiler's design-system spec, so this proves the spec path ran.
    assert.equal(manifest.tokens.find(t=>t.name==='spacing.-1').value,'calc(0.25rem * -1)');
    const brand=manifest.tokens.find(t=>t.name==='colors.brand');
    assert.deepEqual([brand.cssVar, brand.source, manifest.themes.elysium.find(t=>t.name==='colors.brand').source], ['--colors-brand','elysium','elysium']);
    assert.equal(manifest.tokens.find(t=>t.name==='colors.red').source,'panda.config.ts');
    assert.deepEqual(manifest.recipes.badge, {variants:{size:['sm','lg']}, defaultVariants:{size:'sm'}});
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
