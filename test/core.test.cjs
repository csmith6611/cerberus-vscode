const {test} = require('node:test');
const assert = require('node:assert/strict');
const {getContext, getContexts, readThemeAttributes, highestThemeAttributes, recipeName} = require('../dist/context');
const {readManifest, mergeTokens, resolveToken, conditionsFor, swatchColors, applyTheme, recipesFromConfig} = require('../dist/tokens');
function ctx(source, options) { const i = source.indexOf('|'); return getContext(source.replace('|',''), i, options); }
test('JSX aliases, css props and nested conditions', () => {
  const prefix = `import {Box as Panel} from '@cerberus-design/react'; `;
  assert.equal(ctx(prefix + `<Panel bgColor="pa|"/>`).category, 'colors');
  assert.equal(ctx(prefix + `<Panel css={{_hover: {bg: 'pa|'}}}/>`).category, 'colors');
  assert.equal(ctx(prefix + `<Panel p={{base:'1', md:'2|'}}/>`).category, 'spacing');
  assert.equal(ctx(prefix + `<Panel css={{color:{base:'x|', _dark:'y'}}}/>`).category, 'colors');
});
test('incomplete strings and exact replacement ranges', () => {
  const source = `import {css} from './styled-system/css'; css({bg:'pa|`;
  const c = ctx(source);
  assert.equal(c.category, 'colors');
  assert.equal(source.replace('|','').slice(c.start,c.end),'pa');
});
test('recognizes aliases, custom import roots, recipes, factory', () => {
  assert.equal(ctx(`import {css as styles} from '@/styled-system/css'; styles({p:'2|'})`, {importRoots:['@/styled-system']}).category, 'spacing');
  assert.equal(ctx(`import {defineRecipe} from '@pandacss/dev'; defineRecipe({base:{bg:'x|'}})`).category,'colors');
  assert.equal(ctx(`import {cerberus} from '@cerberus/react'; <cerberus.div bg="x|"/>`).category,'colors');
  assert.equal(ctx(`<MyPanel color="x|"/>`,{components:['MyPanel']}).category,'colors');
});
test('does not suggest in unrelated objects, components, keys or expressions', () => {
  for (const text of [`const x={color:'x|'};`, `<div color="x|"/>`, `import {Box} from '@cerberus/react'; <Box title="x|"/>`, `const x=css({color:'x|'});`, `import {css} from 'styled-system/css'; css({'co|lor':'x'})`, `import {Box} from '@cerberus/react'; <Box color={getColor('x|')}/>`]) assert.equal(ctx(text),undefined,text);
});
test('token() uses full names only with an appropriate import', () => {
  assert.equal(ctx(`import {token} from 'styled-system/tokens'; token('colors.x|')`).fullName,true);
  assert.equal(ctx(`token('colors.x|')`),undefined);
});
test('merges semantic tokens, preserves metadata and resolves aliases by mode', () => {
  const tokens = mergeTokens({colors:{blue:{value:'#00f'}}},{colors:{surface:{value:{base:'{colors.blue}',_light:'#fff'},description:'Surface',deprecated:'Use bg.initial'}}});
  assert.equal(tokens.length,2);
  assert.equal(tokens[1].description,'Surface');
  assert.equal(tokens[1].semantic,true);
  assert.equal(resolveToken(tokens[1],tokens).value,'#00f');
  assert.equal(resolveToken(tokens[1],tokens,'_light').value,'#fff');
  assert.deepEqual(conditionsFor(tokens[1],tokens),['base','_light']);
  const roundtrip=readManifest(JSON.stringify({schemaVersion:1,tokens})); assert.equal(roundtrip.tokens.length,2);
});
test('detects cyclic and missing aliases', () => {
  const tokens=mergeTokens({}, {colors:{a:{value:'{colors.b}'}, b:{value:'{colors.a}'}, c:{value:'{colors.missing}'}}});
  assert.equal(resolveToken(tokens[0],tokens).unresolved,true);
  assert.equal(resolveToken(tokens[2],tokens).unresolved,true);
});
test('composite tokens stay intact; conditional aliases expose inherited modes', () => {
  const tokens=mergeTokens({shadows:{sm:{value:{offsetX:0,blur:8}}}},{colors:{a:{value:'{colors.b}'},b:{value:{base:'#000',_dark:'#fff'}}}});
  assert.deepEqual(resolveToken(tokens[0],tokens).value,{offsetX:0,blur:8});
  assert.deepEqual(conditionsFor(tokens[1],tokens),['base','_dark']);
});
test('invalid manifest shapes and duplicate names are rejected', () => {
  for (const data of [{}, {schemaVersion:2,tokens:[]}, {schemaVersion:1,tokens:[{name:'x',category:'colors',value:1}]}, {schemaVersion:1,tokens:[{name:'colors.x',category:'colors',value:1},{name:'colors.x',category:'colors',value:2}]}]) assert.throws(()=>readManifest(JSON.stringify(data)));
});

test('Panda DEFAULT leaves use the parent token name', () => {
  const tokens = mergeTokens({colors:{brand:{DEFAULT:{value:'#123'},strong:{value:'#456'}}}},{});
  assert.equal(tokens[0].name,'colors.brand');
  assert.equal(tokens[1].name,'colors.brand.strong');
});

test('getContexts finds every token string in a document', () => {
  const source = `import {css} from 'styled-system/css'; import {token} from 'styled-system/tokens'; import {Box} from '@cerberus/react';
const a = css({bg:'page.bg', p:'4', _hover:{color:'page.fg'}}); const b = token('colors.x'); const c = {color:'plain'};
<Box bgColor="page.surface" title="nope"/>`;
  assert.deepEqual(getContexts(source).map(c => [c.category, c.value, source.slice(c.start, c.end)]),
    [['colors','page.bg','page.bg'],['spacing','4','4'],['colors','page.fg','page.fg'],['*','colors.x','colors.x'],['colors','page.surface','page.surface']]);
});
test('swatch colours resolve aliases and modes, and reject non-previewable values', () => {
  const tokens = mergeTokens({colors:{blue:{value:'#00f'}, white:{value:'rgb(255 255 255 / 50%)'}, cur:{value:'currentColor'}, v:{value:'var(--x)'}, bad:{value:'red;} body{x:y'}}, spacing:{4:{value:'1rem'}}},
    {colors:{surface:{value:{base:'{colors.blue}', _dark:'{colors.white}'}}, same:{value:{base:'{colors.blue}', _dark:'#00f'}}, missing:{value:'{colors.nope}'}}});
  const get = name => swatchColors(tokens.find(t => t.name === name), tokens);
  assert.deepEqual(get('colors.blue'), ['#00f']);
  assert.deepEqual(get('colors.surface'), ['#00f', 'rgb(255 255 255 / 50%)']);
  assert.deepEqual(get('colors.same'), ['#00f']);
  for (const name of ['colors.cur', 'colors.v', 'colors.bad', 'colors.missing', 'spacing.4']) assert.deepEqual(get(name), [], name);
});
test('swatch modes pick light/dark conditions, falling back to base', () => {
  const tokens = mergeTokens({}, {colors:{a:{value:{base:'#111', _dark:'#222'}}, b:{value:{base:'#111', _lightMode:'#eee', _darkMode:'#333'}}, c:{value:'#555'}}});
  const get = (name, mode) => swatchColors(tokens.find(t => t.name === name), tokens, mode);
  assert.deepEqual([get('colors.a','light'), get('colors.a','dark')], [['#111'], ['#222']]);
  assert.deepEqual([get('colors.b','light'), get('colors.b','dark'), get('colors.b','both')], [['#eee'], ['#333'], ['#eee','#333']]);
  assert.deepEqual([get('colors.c','light'), get('colors.c','dark')], [['#555'], ['#555']]);
});

test('theme variants override base tokens, and semantic aliases resolve through them', () => {
  const tokens = mergeTokens({colors:{brand:{40:{value:'#9f66d3'}, 80:{value:'#39006d'}}}},
    {colors:{action:{text:{100:{value:{base:'{colors.brand.40}', _darkMode:'{colors.brand.40}', _lightMode:'{colors.brand.80}'}, description:'Action text'}}}}});
  const manifest = readManifest(JSON.stringify({schemaVersion:1, tokens, themes:{elysium:mergeTokens({colors:{brand:{40:{value:'#00a3a3'}, 80:{value:'#004d4d'}}, extra:{value:'#fff'}}},{})}}));
  const themed = applyTheme(manifest, 'elysium');
  const action = themed.find(t => t.name === 'colors.action.text.100');
  assert.deepEqual([swatchColors(action, themed, 'dark'), swatchColors(action, themed, 'light')], [['#00a3a3'], ['#004d4d']]);
  assert.equal(action.description, 'Action text');
  assert.ok(themed.some(t => t.name === 'colors.extra'));
  assert.equal(applyTheme(manifest, 'cerberus'), manifest.tokens);
  assert.equal(applyTheme(manifest, 'constructor'), manifest.tokens);
  assert.throws(() => readManifest(JSON.stringify({schemaVersion:1, tokens, themes:{x:[{name:'bad'}]}})));
});
test('Panda v2 design-system spec: themed aliases follow the theme primitives, derived values stay literal', () => {
  // Shape from panda codegen --spec: themed semantic values are pre-resolved against base primitives (#9f66d3), refs name the alias.
  const spec = {schemaVersion:1, categories:{}, paths:[], conditions:{}, themes:{acheron:{id:'panda-theme-acheron', selector:'[data-panda-theme=acheron]'}},
    tokens:{'colors.brand.40':{category:'colors'}, 'colors.brand.80':{category:'colors'}, 'spacing.1':{category:'spacing'}, 'spacing.-1':{category:'spacing'},
      'colors.action':{category:'colors', semantic:true, description:'Action', deprecated:true, deprecatedReason:'Use brand'}, 'colors.old':{category:'colors', deprecated:true, description:''}},
    values:[
      {token:'colors.action', value:'#9f66d3', refs:['colors.brand.40']}, {token:'colors.action', condition:'_light', value:'#39006d', refs:['colors.brand.80']},
      {token:'colors.action', theme:'acheron', value:'#9f66d3', refs:['colors.brand.40']}, {token:'colors.action', theme:'acheron', condition:'_light', value:'#9f66d3', refs:['colors.brand.40']},
      {token:'colors.brand.40', value:'#9f66d3'}, {token:'colors.brand.40', theme:'acheron', value:'#f4ca93'}, {token:'colors.brand.80', value:'#39006d'},
      {token:'colors.old', value:'#000'}, {token:'spacing.1', value:'0.25rem'}, {token:'spacing.-1', value:'calc(0.25rem * -1)', refs:['spacing.1']}]};
  const manifest = readManifest(JSON.stringify(spec));
  const action = manifest.tokens.find(t => t.name === 'colors.action');
  assert.deepEqual(action.value, {base:'{colors.brand.40}', _light:'{colors.brand.80}'});
  assert.deepEqual([action.semantic, action.description, action.deprecated], [true, 'Action', 'Use brand']);
  const old = manifest.tokens.find(t => t.name === 'colors.old');
  assert.deepEqual([old.deprecated, 'description' in old], [true, false]);
  assert.equal(manifest.tokens.find(t => t.name === 'spacing.-1').value, 'calc(0.25rem * -1)');
  assert.deepEqual(manifest.themes.acheron.map(t => t.name), ['colors.brand.40', 'colors.action']);
  const themed = applyTheme(manifest, 'acheron');
  const themedAction = themed.find(t => t.name === 'colors.action');
  assert.deepEqual([swatchColors(themedAction, themed, 'dark'), swatchColors(themedAction, themed, 'light')], [['#f4ca93'], ['#f4ca93']]);
  assert.deepEqual(resolveToken(themedAction, themed).chain, ['colors.action', 'colors.brand.40']);
  assert.deepEqual(swatchColors(action, manifest.tokens, 'both'), ['#39006d', '#9f66d3']);
  assert.throws(() => readManifest(JSON.stringify({...spec, schemaVersion:2})), /schemaVersion 2/);
});
test('spec metadata: CSS variables, defining preset (the theme preset for themed values) and recipes', () => {
  const spec = {schemaVersion:1, categories:{}, paths:[], conditions:{},
    themes:{elysium:{id:'panda-theme-elysium', selector:'[data-panda-theme=elysium]', source:1}},
    tokens:{'colors.brand':{category:'colors', cssVar:'--cerberus-colors-brand', source:0}, 'colors.local':{category:'colors', cssVar:'--cerberus-colors-local', source:2}, 'colors.untracked':{category:'colors'}},
    values:[{token:'colors.brand', value:'#00f'}, {token:'colors.brand', theme:'elysium', value:'#0ff'}, {token:'colors.local', value:'#f00'}, {token:'colors.untracked', value:'#000'}],
    recipes:{button:{className:'button', variants:{size:{values:['sm','lg'], allowsBoolean:false}}, defaultVariants:{size:'lg'}, description:'Buttons'}},
    slotRecipes:{accordion:{className:'accordion', slots:['root'], variants:{open:{values:['true','false'], allowsBoolean:true}}, deprecated:'Use disclosure'}},
    sources:{entries:[{kind:'preset', specifier:'@cerberus-design/react', name:'@cerberus-design/react'}, {kind:'preset', name:'@cerberus/preset-elysium-theme'}, {kind:'config', file:'panda.config.ts'}]}};
  const manifest = readManifest(JSON.stringify(spec));
  const get = (tokens, name) => tokens.find(t => t.name === name);
  assert.deepEqual([get(manifest.tokens,'colors.brand').cssVar, get(manifest.tokens,'colors.brand').source], ['--cerberus-colors-brand', '@cerberus-design/react']);
  assert.equal(get(manifest.tokens,'colors.local').source, 'panda.config.ts');
  assert.deepEqual(['cssVar' in get(manifest.tokens,'colors.untracked'), 'source' in get(manifest.tokens,'colors.untracked')], [false, false]);
  const themed = get(applyTheme(manifest,'elysium'),'colors.brand');
  assert.deepEqual([themed.source, themed.cssVar], ['@cerberus/preset-elysium-theme', '--cerberus-colors-brand']);
  assert.deepEqual(manifest.recipes, {button:{variants:{size:['sm','lg']}, defaultVariants:{size:'lg'}, description:'Buttons'}, accordion:{variants:{open:['true','false']}, deprecated:'Use disclosure'}});
  assert.throws(() => readManifest(JSON.stringify({schemaVersion:1, tokens:[], recipes:{x:{variants:{size:'sm'}}}})));
});
test('recipes from a resolved config', () => {
  assert.deepEqual(recipesFromConfig({recipes:{button:{variants:{size:{sm:{},lg:{}}, primary:{true:{}}}, defaultVariants:{size:'sm', primary:true}, deprecated:true}}, slotRecipes:{card:{slots:['root'], variants:{tone:{a:{root:{}}}}}}}),
    {button:{variants:{size:['sm','lg'], primary:['true']}, defaultVariants:{size:'sm', primary:'true'}, deprecated:true}, card:{variants:{tone:['a']}}});
  assert.deepEqual(recipesFromConfig(undefined), {});
});
test('recipe variant contexts for recipe components and styled-system recipe calls', () => {
  const recipes = {button:{variants:{palette:[], size:[]}}, buttonGroup:{variants:{layout:[]}}, accordion:{variants:{size:[]}}};
  const opts = {recipes};
  const prefix = `import {Button, ButtonGroup, Accordion, Box} from '@cerberus-design/react'; import {button as btn} from 'styled-system/recipes'; `;
  const v = (source, o = opts) => { const c = ctx(prefix + source, o); return c && [c.category, c.recipe, c.property, c.value]; };
  assert.deepEqual(v(`<Button palette="ac|"/>`), ['variant','button','palette','ac']);
  assert.deepEqual(v(`<Button palette={cond ? 'da|' : 'x'}/>`), ['variant','button','palette','da']);
  assert.deepEqual(v(`<ButtonGroup layout="|"/>`), ['variant','buttonGroup','layout','']);
  assert.deepEqual(v(`<Accordion.Root size="s|"/>`), ['variant','accordion','size','s']);
  assert.deepEqual(v(`btn({size: 'l|'})`), ['variant','button','size','l']);
  assert.deepEqual(v(`btn({size: {base: 'sm', md: 'l|'}})`), ['variant','button','size','l']);
  // Style props, unknown variants, no recipe index, and recipes not imported from styled-system are unchanged.
  assert.deepEqual(v(`<Button bg="pa|"/>`), ['colors',undefined,'bg','pa']);
  assert.equal(v(`<Button title="x|"/>`), undefined);
  assert.equal(v(`<Box size="x|"/>`), undefined);
  assert.equal(v(`<Button palette="x|"/>`, {}), undefined);
  assert.equal(ctx(`import {button} from './button'; button({size: 'l|'})`, opts), undefined);
  assert.deepEqual(['Button','ButtonGroup','Accordion.Root','closableTag'].map(recipeName), ['button','buttonGroup','accordion','closableTag']);
  const source = prefix + `<Button palette="action" bg="page.bg"/>`;
  assert.deepEqual(getContexts(source, opts).map(c => [c.category, c.value]), [['variant','action'], ['colors','page.bg']]);
});
test('reads static data-panda-theme and data-color-mode attributes', () => {
  assert.deepEqual(readThemeAttributes(`<html\n  lang="en"\n  data-panda-theme="elysium"\n  data-color-mode="dark"\n  className={generalSans.variable}\n>`), {theme:'elysium', colorMode:'dark'});
  assert.deepEqual(readThemeAttributes(`<html data-panda-theme={'acheron'} data-color-mode={mode}>`), {theme:'acheron', colorMode:undefined});
  assert.deepEqual(readThemeAttributes(`<html lang="en">`), {theme:undefined, colorMode:undefined});
});

test('monorepo theme detection prefers the app root, then the highest match in the repo', () => {
  const files = [
    ['/repo/apps/web/src/components/Preview.tsx', {colorMode:'light'}],
    ['/repo/apps/web/app/layout.tsx', {theme:'elysium', colorMode:'dark'}],
    ['/repo/apps/admin/app/layout.tsx', {theme:'acheron', colorMode:'light'}],
    ['/repo/apps/web/app/demo/layout.tsx', {theme:'oceanus'}],
  ];
  assert.deepEqual(highestThemeAttributes(files, '/repo/apps/web'), {theme:'elysium', colorMode:'dark'});
  assert.deepEqual(highestThemeAttributes(files, '/repo/apps/admin/'), {theme:'acheron', colorMode:'light'});
  // Config in a shared package with no layout of its own: highest in the repo, ties broken by path.
  assert.deepEqual(highestThemeAttributes(files, '/repo/packages/theme'), {theme:'acheron', colorMode:'light'});
  assert.deepEqual(highestThemeAttributes([], '/repo'), {theme:undefined, colorMode:undefined});
});
