// Fabric library. Stretch is the rough safe elongation before a fabric starts to strain or tear.
// Values are sensible starting defaults from mill spec sheets, not lab measurements.
//
// Saves store a fabric by `id` and a colour by its index in `colors`, so ids never change and new colours are only
// ever appended to the end of a card. The first fabrics (canvas ... spandex) keep their original physics exactly so
// the drape baselines stay bit for bit the same.

export type Weave =
  // original textures
  | 'canvas' | 'twill' | 'poplin' | 'linen' | 'wool' | 'poly' | 'jersey' | 'leather' | 'spandex'
  // added with the big library (src/lib/textures.ts renders by weave; WEAVE_BASE gives a close older one)
  | 'oxford' | 'chambray' | 'flannel' | 'seersucker' | 'slub' | 'rib' | 'pique' | 'terry' | 'fleece' | 'waffle'
  | 'ripstop' | 'corduroy' | 'velvet' | 'satin' | 'crepe' | 'suede' | 'mesh' | 'tweed' | 'waxed';

/** Closest original texture for each weave, for a renderer that does not draw a weave yet. */
export const WEAVE_BASE: Record<Weave, 'canvas' | 'twill' | 'poplin' | 'linen' | 'wool' | 'poly' | 'jersey' | 'leather' | 'spandex'> = {
  canvas: 'canvas', twill: 'twill', poplin: 'poplin', linen: 'linen', wool: 'wool', poly: 'poly', jersey: 'jersey', leather: 'leather', spandex: 'spandex',
  oxford: 'canvas', chambray: 'poplin', flannel: 'wool', seersucker: 'linen', slub: 'jersey', rib: 'jersey', pique: 'jersey',
  terry: 'jersey', fleece: 'wool', waffle: 'canvas', ripstop: 'poly', corduroy: 'twill', velvet: 'wool', satin: 'poly',
  crepe: 'linen', suede: 'leather', mesh: 'spandex', tweed: 'wool', waxed: 'canvas',
};

/** Generic woven / printed fabric patterns (no trademarked designs). Drawn procedurally in 2D and 3D, sized in cm. */
export type PatternId =
  | 'solid' | 'stripe' | 'pinstripe' | 'breton' | 'awning' | 'gingham' | 'check' | 'plaid' | 'tartan' | 'windowpane'
  | 'houndstooth' | 'herringbone' | 'chevron' | 'polka' | 'pindot' | 'grid' | 'camo' | 'floral' | 'paisley'
  | 'animal' | 'geo' | 'tie-dye' | 'heather' | 'jacquard'
  /** star stitch: small five point stars repeated all over (knitted in as a jacquard, or embroidered) */
  | 'star'
  /** the user's own motif repeated by FabricPattern.motif / layout (e.g. a fleur de lis they drew or uploaded) */
  | 'custom';

/** How a custom motif repeats, like a print designer's repeat types. */
export type RepeatLayout = 'block' | 'half-drop' | 'brick' | 'mirror' | 'turn' | 'scatter';

export interface PatternMotif {
  /** the motif as a picture (data URL, transparent background, at most 1024 px) */
  image?: string;
  /** or as traced vector shapes, one per colour, SVG path in the unit box -0.5..0.5 (evenodd) */
  paths?: { color: string; path: string }[];
  /** motif width / height ratio */
  aspect: number;
  /** when the upload was already a repeating pattern: the detected repeat tile in source pixels */
  detectedTile?: { w: number; h: number };
  /** up to 8 quantised colours of the picture (hex), most used first; hidden and recolor refer to these */
  palette?: string[];
  /** the picture before colours were hidden or recoloured (image holds the edited result) */
  source?: string;
}

export interface FabricPattern {
  id: PatternId;
  /** colours used by the pattern, first = ground (CSS hex) */
  colors: string[];
  /** repeat size in cm */
  scale: number;
  /** degrees, relative to the grainline */
  rotation: number;
  /** printed on top of the cloth, or woven / knitted into it (woven patterns also show on the inside) */
  method?: 'printed' | 'woven';
  /** id 'custom': the motif and how it repeats */
  motif?: PatternMotif;
  layout?: RepeatLayout;
  /** motif size as a share of the repeat cell (0.2 to 1) */
  motifScale?: number;
  /** recolour vector motifs: colours replace motif.paths colours in order */
  recolor?: string[];
  /** how strongly the pattern shows over the base cloth colour, 0 to 1 (omitted = 1) */
  opacity?: number;
  /** shift of the pattern on the cloth along its own axes, cm (omitted = 0) */
  offsetX?: number;
  offsetY?: number;
  /** colour indexes that are hidden so the cloth shows through (built in: index into colors, never 0; motif: index into its colours) */
  hidden?: number[];
}

export type FabricCategory = 'shirting' | 'denim' | 'knits' | 'outerwear' | 'special';

export const FABRIC_CATEGORIES: { id: FabricCategory; name: string; blurb: string }[] = [
  { id: 'shirting', name: 'Shirting', blurb: 'Light woven cottons and linens for shirts and blouses.' },
  { id: 'denim', name: 'Denim', blurb: 'Cotton twills for jeans and jackets, rigid to stretch.' },
  { id: 'knits', name: 'Knits', blurb: 'Knitted cloth that stretches: tees, polos, sweats, trims.' },
  { id: 'outerwear', name: 'Outerwear and bottoms', blurb: 'Heavier wovens for jackets, coats, workwear and trousers.' },
  { id: 'special', name: 'Special', blurb: 'Sheen, pile, leathers, mesh and technical stretch.' },
];

export interface Fabric {
  id: string;
  name: string;
  category: FabricCategory;
  blurb: string;
  stretch: number; // fraction, 0.04 = 4%
  weight: 'Light' | 'Medium' | 'Heavy';
  gsm: number;
  weave: Weave;
  roughness: number;
  /** bending stiffness 0..1 (1 = stiff like canvas, low = drapey like jersey) */
  bend: number;
  colors: { name: string; hex: string }[];
}

type C = [string, string];
const card = (cs: C[]) => cs.map(([name, hex]) => ({ name, hex }));

export const FABRICS: Fabric[] = [
  // ---- original library (ids, physics and first colours unchanged) ----
  {
    id: 'canvas', category: 'outerwear', bend: 1.0, name: 'Cotton Canvas', weave: 'canvas', stretch: 0.03, weight: 'Heavy', gsm: 340, roughness: 0.95,
    blurb: 'Stiff and tough, barely stretches. Chore jackets, workwear, bags.',
    colors: card([['Tan', '#c8a978'], ['Olive', '#6b6f45'], ['Natural', '#e6dcc6'], ['Black', '#2b2b2b'], ['Hamilton brown', '#8a5a33'],
      ['Navy', '#283246'], ['Moss', '#55603f'], ['Rust', '#9a4d2e'], ['Stone', '#bdb4a2'], ['Charcoal', '#45464a'], ['Ecru', '#efe7d4'], ['Mustard', '#c39a3c']]),
  },
  {
    id: 'denim', category: 'denim', bend: 0.85, name: 'Denim', weave: 'twill', stretch: 0.04, weight: 'Heavy', gsm: 400, roughness: 0.9,
    blurb: 'Rigid cotton twill. Jeans and trucker jackets. Breaks in but does not give much.',
    colors: card([['Indigo', '#2e3f66'], ['Mid wash', '#5878a3'], ['Light wash', '#9cb3cf'], ['Black', '#25272c'], ['Dark rinse', '#232f4c'],
      ['Stone wash', '#7a92b4'], ['Bleach', '#bfcde0'], ['Vintage blue', '#6a84a8'], ['Grey wash', '#6e737c'], ['Ecru', '#e8e0cc']]),
  },
  {
    id: 'stretch-denim', category: 'denim', bend: 0.6, name: 'Stretch Denim', weave: 'twill', stretch: 0.15, weight: 'Medium', gsm: 340, roughness: 0.88,
    blurb: 'Denim with a little elastane mixed in. Skinny and slim jeans.',
    colors: card([['Indigo', '#2b3a5e'], ['Mid wash', '#56739c'], ['Grey', '#6d7077'], ['Black', '#222428'], ['Dark rinse', '#202a44'],
      ['Light wash', '#99b0cc'], ['Ice', '#c7d4e4'], ['Charcoal', '#43464c']]),
  },
  {
    id: 'poplin', category: 'shirting', bend: 0.35, name: 'Cotton Poplin', weave: 'poplin', stretch: 0.03, weight: 'Light', gsm: 120, roughness: 0.8,
    blurb: 'Smooth, crisp shirting cotton. Dress shirts. Almost no stretch.',
    colors: card([['White', '#f4f4f1'], ['Sky', '#b9d0ea'], ['Pink', '#efc9cc'], ['Navy', '#2a3550'], ['Ecru', '#efe9dc'], ['Lilac', '#cfc3e0'],
      ['Mint', '#c6e3d3'], ['Lemon', '#f2e8b0'], ['Black', '#1f2024'], ['Sage', '#a9b79d'], ['French blue', '#7e9cc8'], ['Stone', '#cbc3b3']]),
  },
  {
    id: 'linen', category: 'shirting', bend: 0.4, name: 'Linen', weave: 'linen', stretch: 0.02, weight: 'Light', gsm: 160, roughness: 0.95,
    blurb: 'Breathable and textured, wrinkles easily. Summer shirts and trousers. No stretch.',
    colors: card([['Oat', '#d9ccb2'], ['White', '#efece4'], ['Sage', '#a7b39a'], ['Rust', '#a8573a'], ['Sand', '#cdb894'], ['Sky', '#aac3da'],
      ['Navy', '#2d3a55'], ['Olive', '#7a7a52'], ['Terracotta', '#b8684a'], ['Black', '#26262a'], ['Natural flax', '#bfae8e'], ['Blush', '#e3c2b8']]),
  },
  {
    id: 'wool', category: 'outerwear', bend: 0.55, name: 'Wool Suiting', weave: 'wool', stretch: 0.08, weight: 'Medium', gsm: 280, roughness: 1,
    blurb: 'Warm with a soft natural give. Suits, coats, overshirts.',
    colors: card([['Charcoal', '#4a4c52'], ['Camel', '#b88a5a'], ['Navy', '#28304a'], ['Heather grey', '#9a9a9a'], ['Black', '#222326'],
      ['Mid grey', '#76787d'], ['Brown', '#5a4434'], ['Bottle green', '#2f4637'], ['Burgundy', '#5c2530'], ['Oatmeal', '#cbbfa8'], ['Slate blue', '#4d5d78']]),
  },
  {
    id: 'poly', category: 'outerwear', bend: 0.25, name: 'Polyester', weave: 'poly', stretch: 0.06, weight: 'Light', gsm: 150, roughness: 0.45,
    blurb: 'Smooth synthetic with a slight sheen. Windbreakers, linings, sportswear.',
    colors: card([['Black', '#1f2023'], ['Red', '#b3262d'], ['Cobalt', '#2a52be'], ['Silver', '#b9bcc2'], ['White', '#f1f2f3'], ['Navy', '#1f2a44'],
      ['Forest', '#24483a'], ['Orange', '#e0682a'], ['Yellow', '#f2c230'], ['Teal', '#1b7c80'], ['Purple', '#5b3e8f'], ['Khaki', '#a39a74']]),
  },
  {
    id: 'jersey', category: 'knits', bend: 0.12, name: 'Cotton Jersey', weave: 'jersey', stretch: 0.3, weight: 'Light', gsm: 180, roughness: 0.9,
    blurb: 'Soft knitted cotton like a T-shirt. Stretches comfortably.',
    colors: card([['White', '#f2f2f0'], ['Heather grey', '#a3a5a8'], ['Black', '#232325'], ['Forest', '#2f4a3a'], ['Navy', '#262f45'], ['Red', '#b02a30'],
      ['Royal', '#2d4fa0'], ['Natural', '#ece6d8'], ['Charcoal heather', '#55575b'], ['Butter', '#f1e3a6'], ['Pink', '#eab8c3'], ['Olive', '#6b6b46'],
      ['Sky', '#a9c6e3'], ['Burgundy', '#5e2430'], ['Mustard', '#c99b33'], ['Lavender', '#b9acd6']]),
  },
  {
    id: 'rib', category: 'knits', bend: 0.15, name: 'Rib Knit', weave: 'rib', stretch: 0.6, weight: 'Medium', gsm: 230, roughness: 0.9,
    blurb: 'Ribbed cotton knit that springs back. Neckbands, collars, cuffs and hem bands.',
    colors: card([['White', '#f2f2f0'], ['Heather grey', '#a3a5a8'], ['Black', '#232325'], ['Forest', '#2f4a3a'], ['Navy', '#262f45'], ['Red', '#b02a30'],
      ['Royal', '#2d4fa0'], ['Natural', '#ece6d8'], ['Charcoal heather', '#55575b'], ['Burgundy', '#5e2430'], ['Olive', '#6b6b46'], ['Mustard', '#c99b33']]),
  },
  {
    id: 'leather', category: 'special', bend: 0.9, name: 'Leather', weave: 'leather', stretch: 0.1, weight: 'Heavy', gsm: 900, roughness: 0.55,
    blurb: 'Lambskin or cowhide. Moulds to the body slowly. Biker jackets.',
    colors: card([['Black', '#1c1b1b'], ['Brown', '#5a3a26'], ['Tan', '#a06b3f'], ['Oxblood', '#4e1c1f'], ['Cognac', '#8a4a24'], ['Dark brown', '#3a261b'],
      ['Navy', '#1f2533'], ['Olive', '#4c4a30'], ['Bone', '#ddd3c0'], ['Burgundy', '#5a1f28']]),
  },
  {
    id: 'spandex', category: 'special', bend: 0.15, name: 'Athletic Spandex', weave: 'spandex', stretch: 0.5, weight: 'Light', gsm: 220, roughness: 0.5,
    blurb: 'Nylon or poly with lots of elastane. Activewear and compression. Very stretchy.',
    colors: card([['Black', '#1b1c20'], ['Slate', '#4b5563'], ['Teal', '#0f766e'], ['Volt', '#c6e33a'], ['Navy', '#1c2540'], ['Berry', '#9b2d5c'],
      ['Coral', '#ef6f5e'], ['Electric blue', '#2563eb'], ['White', '#f3f4f6'], ['Plum', '#4a2a4f'], ['Sage', '#8fa08a'], ['Burnt orange', '#d2602a']]),
  },

  // ---- shirting ----
  {
    id: 'oxford', category: 'shirting', bend: 0.4, name: 'Oxford Cloth', weave: 'oxford', stretch: 0.03, weight: 'Light', gsm: 140, roughness: 0.9,
    blurb: 'Soft basket weave cotton with a little texture. Button down shirts.',
    colors: card([['White', '#f3f2ee'], ['Blue', '#a9c2e0'], ['Pink', '#ecc4c8'], ['Ecru', '#ebe4d3'], ['Yellow', '#efe2a6'], ['Lilac', '#cbbfdc'],
      ['Navy', '#2b3651'], ['Grey', '#b7b9bd'], ['Mint', '#c3dfcf'], ['Off white', '#f1ecea']]),
  },
  {
    id: 'chambray', category: 'shirting', bend: 0.32, name: 'Chambray', weave: 'chambray', stretch: 0.03, weight: 'Light', gsm: 130, roughness: 0.85,
    blurb: 'Plain weave with a coloured warp and white weft, the look of light denim. Work shirts.',
    colors: card([['Light blue', '#9fb4cf'], ['Mid blue', '#6f88ac'], ['Indigo', '#3e5178'], ['Grey', '#9a9fa8'], ['Black', '#4a4c52'],
      ['Olive', '#858a6c'], ['Rust', '#b07a62'], ['Ecru', '#ddd6c5']]),
  },
  {
    id: 'shirting-twill', category: 'shirting', bend: 0.35, name: 'Shirting Twill', weave: 'twill', stretch: 0.03, weight: 'Light', gsm: 135, roughness: 0.78,
    blurb: 'Fine diagonal weave that drapes and resists creasing. Dress and smart shirts.',
    colors: card([['White', '#f5f4f0'], ['Sky', '#b7cde6'], ['Pink', '#eec7cb'], ['Navy', '#29344e'], ['Ice blue', '#d6e2ef'], ['Black', '#1f2024'],
      ['Silver grey', '#c7c9cd'], ['Lavender', '#d2c8e3'], ['Cream', '#f1ead8'], ['Burgundy', '#5d2531']]),
  },
  {
    id: 'flannel', category: 'shirting', bend: 0.38, name: 'Cotton Flannel', weave: 'flannel', stretch: 0.04, weight: 'Medium', gsm: 170, roughness: 1,
    blurb: 'Brushed cotton, soft and warm. Overshirts and winter shirts. Pairs well with plaid.',
    colors: card([['Red', '#9e2d2b'], ['Grey marl', '#8d8f93'], ['Navy', '#2a3248'], ['Forest', '#2f4a3a'], ['Brown', '#5d4433'], ['Oatmeal', '#cdbfa6'],
      ['Charcoal', '#4a4b50'], ['Mustard', '#b98c2f'], ['Black', '#25262a'], ['Burgundy', '#5a2530']]),
  },
  {
    id: 'seersucker', category: 'shirting', bend: 0.3, name: 'Seersucker', weave: 'seersucker', stretch: 0.06, weight: 'Light', gsm: 125, roughness: 0.92,
    blurb: 'Puckered stripes that stand off the skin. Summer shirts and shorts.',
    colors: card([['White', '#f5f4f0'], ['Blue', '#a8c1df'], ['Pink', '#eec3c6'], ['Sage', '#b7c4ab'], ['Navy', '#2f3a55'], ['Yellow', '#f0e1a2'],
      ['Grey', '#bdbfc3'], ['Sand', '#d6c7a8']]),
  },
  {
    id: 'voile', category: 'shirting', bend: 0.12, name: 'Cotton Voile', weave: 'poplin', stretch: 0.03, weight: 'Light', gsm: 70, roughness: 0.7,
    blurb: 'Fine, airy and a little sheer. Summer shirts, blouses and linings.',
    colors: card([['White', '#f7f6f2'], ['Ivory', '#f1ead6'], ['Blush', '#efd0cc'], ['Powder blue', '#c9d9ea'], ['Black', '#1f2023'],
      ['Sage', '#bac6ad'], ['Lilac', '#d6cbe4'], ['Butter', '#f3e6b4']]),
  },

  // ---- denim ----
  {
    id: 'selvedge-denim', category: 'denim', bend: 0.9, name: 'Selvedge Denim', weave: 'twill', stretch: 0.03, weight: 'Heavy', gsm: 470, roughness: 0.92,
    blurb: 'Shuttle loomed 14 to 16 oz twill with a clean finished edge. Fades with wear.',
    colors: card([['Deep indigo', '#1f2c4d'], ['Indigo', '#2b3b62'], ['Mid fade', '#4d6690'], ['Black over indigo', '#22252d'], ['Ecru', '#e4dbc4'],
      ['Green cast', '#2c3b48'], ['Grey weft', '#3b4456'], ['Vintage fade', '#6d86ab']]),
  },
  {
    id: 'raw-denim', category: 'denim', bend: 0.92, name: 'Raw Denim', weave: 'twill', stretch: 0.03, weight: 'Heavy', gsm: 440, roughness: 0.9,
    blurb: 'Unwashed and stiff from the loom. Shrinks a little and moulds to you over time.',
    colors: card([['Raw indigo', '#1d2a4a'], ['Deep indigo', '#18223b'], ['Black raw', '#1c1d22'], ['Grey raw', '#3b3e46'], ['Natural', '#e3dac3'],
      ['Overdyed brown', '#3a2f2a'], ['Overdyed green', '#283327'], ['Midnight', '#141b2e']]),
  },
  {
    id: 'white-denim', category: 'denim', bend: 0.75, name: 'White Denim', weave: 'twill', stretch: 0.05, weight: 'Medium', gsm: 340, roughness: 0.85,
    blurb: 'Undyed or bleached twill, dense enough not to show through. Summer jeans and jackets.',
    colors: card([['Optic white', '#f5f5f2'], ['Ecru', '#ece4cf'], ['Off white', '#efece3'], ['Stone', '#d6cfbf'], ['Pale blue', '#d4dfea'],
      ['Sand', '#dccbab'], ['Pale pink', '#efdcd8'], ['Pale grey', '#d9dadc']]),
  },
  {
    id: 'black-denim', category: 'denim', bend: 0.75, name: 'Black Denim', weave: 'twill', stretch: 0.06, weight: 'Medium', gsm: 360, roughness: 0.88,
    blurb: 'Sulphur dyed black twill, from jet black to washed grey.',
    colors: card([['Jet black', '#18191c'], ['Black', '#222327'], ['Washed black', '#35373c'], ['Charcoal', '#4a4c52'], ['Grey wash', '#6b6e75'],
      ['Ash', '#8f9298'], ['Blue black', '#1d212b'], ['Brown black', '#272220']]),
  },

  // ---- knits ----
  {
    id: 'slub-jersey', category: 'knits', bend: 0.12, name: 'Slub Jersey', weave: 'slub', stretch: 0.3, weight: 'Light', gsm: 160, roughness: 0.92,
    blurb: 'Jersey knitted from uneven yarn for a lived in, textured look. Tees.',
    colors: card([['White', '#f2f1ec'], ['Natural', '#e9e1cf'], ['Grey', '#a4a6a9'], ['Black', '#26272a'], ['Navy', '#2a3248'], ['Sage', '#a5b19a'],
      ['Clay', '#b87a5f'], ['Sky', '#a6c1dc'], ['Olive', '#6f6d4a'], ['Washed black', '#3a3b3f']]),
  },
  {
    id: 'pique', category: 'knits', bend: 0.2, name: 'Pique', weave: 'pique', stretch: 0.2, weight: 'Medium', gsm: 210, roughness: 0.92,
    blurb: 'Honeycomb textured cotton knit that breathes. Polo shirts.',
    colors: card([['White', '#f4f4f2'], ['Navy', '#232c45'], ['Black', '#222326'], ['Red', '#b42a30'], ['Bottle green', '#244233'], ['Sky', '#a8c4e2'],
      ['Pink', '#eebac3'], ['Yellow', '#f0d75e'], ['Grey marl', '#9fa1a4'], ['Burgundy', '#5c2230'], ['Royal', '#2b4da0'], ['Stone', '#cbc1ad']]),
  },
  {
    id: 'interlock', category: 'knits', bend: 0.16, name: 'Interlock', weave: 'jersey', stretch: 0.35, weight: 'Medium', gsm: 220, roughness: 0.85,
    blurb: 'Double knit, smooth on both sides and thicker than jersey. Tees, baby wear, dresses.',
    colors: card([['White', '#f3f3f1'], ['Black', '#222325'], ['Navy', '#262f45'], ['Heather grey', '#a1a3a6'], ['Ivory', '#efe8d6'], ['Dusty rose', '#c99a9a'],
      ['Teal', '#2a6e70'], ['Mustard', '#c49634']]),
  },
  {
    id: 'french-terry', category: 'knits', bend: 0.3, name: 'French Terry', weave: 'terry', stretch: 0.2, weight: 'Medium', gsm: 300, roughness: 0.95,
    blurb: 'Smooth face with soft loops on the back. Sweatshirts, hoodies, joggers.',
    colors: card([['Heather grey', '#a2a4a7'], ['Black', '#232426'], ['Navy', '#252e44'], ['Oatmeal', '#d2c6af'], ['Forest', '#2e4838'], ['Washed red', '#a23a37'],
      ['Charcoal', '#4d4f53'], ['Dusty blue', '#7c93ad'], ['Sand', '#cbb592'], ['Lilac', '#b8aacd'], ['Brown', '#5d4636'], ['White', '#f1f1ee']]),
  },
  {
    id: 'fleece', category: 'knits', bend: 0.35, name: 'Brushed Fleece', weave: 'fleece', stretch: 0.2, weight: 'Heavy', gsm: 330, roughness: 1,
    blurb: 'Loopback knit brushed soft inside. Warm sweatshirts and sweatpants.',
    colors: card([['Heather grey', '#9ea0a3'], ['Black', '#212224'], ['Navy', '#232b40'], ['Cream', '#ece3cf'], ['Forest', '#2c4436'], ['Maroon', '#5a2329'],
      ['Charcoal', '#4a4c50'], ['Royal', '#2a4a9a'], ['Pink', '#e9b4c0'], ['Olive', '#5f5f3e'], ['Orange', '#d8652c'], ['Light blue', '#a7c0dc']]),
  },
  {
    id: 'waffle', category: 'knits', bend: 0.22, name: 'Waffle Knit', weave: 'waffle', stretch: 0.3, weight: 'Medium', gsm: 230, roughness: 0.96,
    blurb: 'Grid of little pockets that trap warmth. Thermals and long sleeve tees.',
    colors: card([['Ecru', '#ebe3cf'], ['White', '#f2f2ef'], ['Grey', '#a3a5a8'], ['Black', '#232426'], ['Sage', '#a3af97'], ['Brown', '#6a5040'],
      ['Navy', '#283048'], ['Rust', '#a45a3c']]),
  },
  {
    id: 'modal', category: 'knits', bend: 0.08, name: 'Modal Jersey', weave: 'jersey', stretch: 0.35, weight: 'Light', gsm: 160, roughness: 0.6,
    blurb: 'Beech fibre jersey, silky soft with a fluid drape. Lounge tees, underwear.',
    colors: card([['Black', '#1f2022'], ['White', '#f4f4f2'], ['Heather grey', '#a6a8ab'], ['Navy', '#243049'], ['Nude', '#d8b8a0'], ['Mauve', '#a7808d'],
      ['Sage', '#a2ae98'], ['Charcoal', '#46484c'], ['Stone', '#c9bfae'], ['Wine', '#5a2333']]),
  },

  // ---- outerwear and bottoms ----
  {
    id: 'duck', category: 'outerwear', bend: 1.0, name: 'Cotton Duck', weave: 'canvas', stretch: 0.02, weight: 'Heavy', gsm: 400, roughness: 0.95,
    blurb: '12 oz tightly woven duck, tougher than canvas. Work jackets, carpenter pants.',
    colors: card([['Brown duck', '#9c6a3c'], ['Black', '#26272a'], ['Moss', '#55603f'], ['Navy', '#2a3349'], ['Natural', '#e2d6bd'], ['Grey', '#6c6e70'],
      ['Rust', '#8f4528'], ['Khaki', '#a8996e']]),
  },
  {
    id: 'ripstop', category: 'outerwear', bend: 0.3, name: 'Ripstop', weave: 'ripstop', stretch: 0.03, weight: 'Light', gsm: 120, roughness: 0.6,
    blurb: 'Light nylon or cotton with a grid of strong threads that stops tears spreading. Cargo and outdoor wear.',
    colors: card([['Olive', '#5e6342'], ['Black', '#1f2022'], ['Khaki', '#a59a73'], ['Navy', '#232b40'], ['Coyote', '#8c7459'], ['Grey', '#7c7f84'],
      ['Orange', '#dd6a2a'], ['Royal', '#2a4a9a'], ['Sand', '#cfbf9c'], ['Forest', '#2a4232']]),
  },
  {
    id: 'nylon-taffeta', category: 'outerwear', bend: 0.15, name: 'Nylon Taffeta', weave: 'poly', stretch: 0.02, weight: 'Light', gsm: 70, roughness: 0.35,
    blurb: 'Light, crisp and slightly shiny. Windbreakers, puffer shells and linings.',
    colors: card([['Black', '#1b1c1f'], ['Navy', '#1f2842'], ['Red', '#c0282f'], ['Royal', '#2552c0'], ['Silver', '#babdc3'], ['Olive', '#565b3a'],
      ['Orange', '#ea6a24'], ['Yellow', '#f4c82c'], ['Teal', '#167c80'], ['White', '#f2f3f4'], ['Purple', '#5a3d92'], ['Pink', '#ec8fb0']]),
  },
  {
    id: 'softshell', category: 'outerwear', bend: 0.45, name: 'Softshell', weave: 'poly', stretch: 0.2, weight: 'Medium', gsm: 290, roughness: 0.55,
    blurb: 'Stretch woven face bonded to a fleece back. Windproof, water resistant jackets.',
    colors: card([['Black', '#1d1e21'], ['Charcoal', '#43464b'], ['Navy', '#1f2840'], ['Olive', '#4e5236'], ['Red', '#a8262d'], ['Royal', '#24479a'],
      ['Slate', '#5a6472'], ['Sand', '#b9a988']]),
  },
  {
    id: 'waxed-cotton', category: 'outerwear', bend: 0.85, name: 'Waxed Cotton', weave: 'waxed', stretch: 0.02, weight: 'Heavy', gsm: 300, roughness: 0.5,
    blurb: 'Cotton coated with wax so rain runs off. Field and country jackets.',
    colors: card([['Sage', '#5e6648'], ['Navy', '#222a3b'], ['Tan', '#8e6d45'], ['Black', '#1f2022'], ['Rustic brown', '#5c4330'], ['Olive', '#4c4d33'],
      ['Stone', '#9a8f78'], ['Burgundy', '#4f2228']]),
  },
  {
    id: 'corduroy', category: 'outerwear', bend: 0.6, name: 'Corduroy', weave: 'corduroy', stretch: 0.06, weight: 'Medium', gsm: 300, roughness: 0.98,
    blurb: 'Cotton with raised ribs (wales) of soft pile. Trousers, overshirts, jackets.',
    colors: card([['Tan', '#b08455'], ['Brown', '#5e4230'], ['Olive', '#6a6a42'], ['Navy', '#263049'], ['Cream', '#e6dcc3'], ['Rust', '#9d4f2e'],
      ['Burgundy', '#5d2430'], ['Forest', '#2e4637'], ['Black', '#242528'], ['Mustard', '#b98a32'], ['Dusty pink', '#c99c9c'], ['Grey', '#7b7d80']]),
  },
  {
    id: 'moleskin', category: 'outerwear', bend: 0.7, name: 'Moleskin', weave: 'suede', stretch: 0.03, weight: 'Heavy', gsm: 340, roughness: 0.92,
    blurb: 'Dense cotton brushed to a soft, suede like face. Trousers and work jackets.',
    colors: card([['Olive', '#5d5f3f'], ['Navy', '#262e45'], ['Tobacco', '#6e4b30'], ['Stone', '#b8ad96'], ['Black', '#252629'], ['Burgundy', '#542430'],
      ['Charcoal', '#48494d'], ['Camel', '#a88259']]),
  },
  {
    id: 'melton', category: 'outerwear', bend: 0.8, name: 'Wool Melton', weave: 'wool', stretch: 0.05, weight: 'Heavy', gsm: 500, roughness: 1,
    blurb: 'Thick felted wool, wind resistant with no fraying. Peacoats, varsity jackets.',
    colors: card([['Navy', '#232a40'], ['Charcoal', '#454649'], ['Camel', '#b48756'], ['Black', '#202123'], ['Bottle green', '#2b4434'], ['Burgundy', '#58222b'],
      ['Grey', '#7c7d80'], ['Cream', '#e6dcc4'], ['Red', '#9c2a2c'], ['Royal', '#2a4590']]),
  },
  {
    id: 'tweed', category: 'outerwear', bend: 0.7, name: 'Tweed', weave: 'tweed', stretch: 0.04, weight: 'Heavy', gsm: 420, roughness: 1,
    blurb: 'Rough, flecked wool woven from mixed colour yarns. Sport coats and caps.',
    colors: card([['Brown mix', '#6d5a45'], ['Grey mix', '#7d7b76'], ['Green mix', '#5b6148'], ['Blue mix', '#4f5a6e'], ['Oatmeal mix', '#b9ac93'],
      ['Charcoal mix', '#4b4a48'], ['Rust mix', '#8a5a40'], ['Heather purple', '#6e5f73']]),
  },
  {
    id: 'gabardine', category: 'outerwear', bend: 0.5, name: 'Gabardine', weave: 'twill', stretch: 0.03, weight: 'Medium', gsm: 260, roughness: 0.7,
    blurb: 'Tight, steep twill that sheds light rain. Trench coats, chinos and trousers.',
    colors: card([['Khaki', '#b5a27a'], ['Stone', '#c9bea6'], ['Navy', '#262f47'], ['Olive', '#636441'], ['Black', '#222326'], ['Camel', '#ae8a5e'],
      ['Charcoal', '#46474b'], ['Taupe', '#8c7f6e'], ['White', '#efece5'], ['Brown', '#5b4535']]),
  },

  // ---- special ----
  {
    id: 'satin', category: 'special', bend: 0.1, name: 'Satin', weave: 'satin', stretch: 0.03, weight: 'Light', gsm: 110, roughness: 0.25,
    blurb: 'Glossy face, matte back, very fluid drape. Slip dresses, linings, bomber jackets.',
    colors: card([['Black', '#1a1a1d'], ['Ivory', '#f1e9d6'], ['Champagne', '#e3cfab'], ['Navy', '#1f2742'], ['Emerald', '#1f6b4f'], ['Burgundy', '#5c1f2c'],
      ['Silver', '#c4c6cb'], ['Blush', '#efc9c4'], ['Royal', '#274aa5'], ['Gold', '#c9a24a'], ['Olive', '#5f6040'], ['Red', '#b2232c']]),
  },
  {
    id: 'silk-crepe', category: 'special', bend: 0.08, name: 'Silk Crepe', weave: 'crepe', stretch: 0.05, weight: 'Light', gsm: 90, roughness: 0.7,
    blurb: 'Silk with a fine pebbled texture and a soft, heavy fall. Blouses and dresses.',
    colors: card([['Ivory', '#f2ebdc'], ['Black', '#1d1d20'], ['Nude', '#dcbca5'], ['Navy', '#222b45'], ['Sage', '#a5b19b'], ['Dusty blue', '#8ea3bc'],
      ['Rose', '#cf9aa0'], ['Bordeaux', '#5b2131'], ['Taupe', '#9c8d7e'], ['Teal', '#2b6c70']]),
  },
  {
    id: 'velvet', category: 'special', bend: 0.35, name: 'Velvet', weave: 'velvet', stretch: 0.05, weight: 'Medium', gsm: 300, roughness: 1,
    blurb: 'Dense short pile that catches light. Evening jackets, tracksuits, trims.',
    colors: card([['Black', '#17171a'], ['Burgundy', '#4e1825'], ['Emerald', '#1b5440'], ['Midnight', '#1b2140'], ['Royal', '#2a3f95'], ['Plum', '#4a2348'],
      ['Rust', '#8a3f24'], ['Olive', '#4a4b2c'], ['Dusty pink', '#c5939b'], ['Champagne', '#d8c29c']]),
  },
  {
    id: 'suede', category: 'special', bend: 0.8, name: 'Suede', weave: 'suede', stretch: 0.08, weight: 'Heavy', gsm: 700, roughness: 1,
    blurb: 'Napped split leather, soft and matte. Trucker and western jackets.',
    colors: card([['Tan', '#a7764a'], ['Chocolate', '#4e3424'], ['Sand', '#c8ae88'], ['Black', '#222124'], ['Navy', '#283048'], ['Olive', '#5e5b3a'],
      ['Rust', '#8f4a2c'], ['Taupe', '#8a7a68']]),
  },
  {
    id: 'faux-leather', category: 'special', bend: 0.7, name: 'Faux Leather', weave: 'leather', stretch: 0.08, weight: 'Medium', gsm: 450, roughness: 0.4,
    blurb: 'PU coated knit backing that looks like leather. Jackets and trousers, easy care.',
    colors: card([['Black', '#1a1a1c'], ['Brown', '#563827'], ['Tan', '#9c6a40'], ['Burgundy', '#521d27'], ['Cream', '#e9dfc9'], ['Olive', '#4d4b31'],
      ['Navy', '#1f2534'], ['Red', '#9e1f27'], ['White', '#f1f0ec'], ['Taupe', '#857565']]),
  },
  {
    id: 'mesh', category: 'special', bend: 0.1, name: 'Athletic Mesh', weave: 'mesh', stretch: 0.4, weight: 'Light', gsm: 140, roughness: 0.6,
    blurb: 'Open knit full of small holes for airflow. Jerseys, linings and vents.',
    colors: card([['White', '#f3f4f5'], ['Black', '#1d1e20'], ['Navy', '#1e2740'], ['Red', '#c12a31'], ['Royal', '#2450b5'], ['Grey', '#9a9da2'],
      ['Volt', '#cbe43c'], ['Orange', '#ea6b25'], ['Green', '#218a4b'], ['Purple', '#5d3e96']]),
  },
  {
    id: 'tech-stretch', category: 'special', bend: 0.3, name: 'Technical Stretch Woven', weave: 'poly', stretch: 0.18, weight: 'Medium', gsm: 180, roughness: 0.5,
    blurb: 'Four way stretch nylon weave, quick drying. Travel trousers, hiking and golf wear.',
    colors: card([['Black', '#1c1d20'], ['Graphite', '#3c3f44'], ['Navy', '#1e273e'], ['Khaki', '#a09574'], ['Olive', '#545839'], ['Stone', '#bdb4a2'],
      ['Slate blue', '#4d5d78'], ['Rust', '#9a4c2d'], ['White', '#eeeff0'], ['Sage', '#8f9c87']]),
  },
];

const BY_ID = new Map(FABRICS.map((f) => [f.id, f]));
const FALLBACK = BY_ID.get('canvas')!;

/** Fabric by id; unknown ids (very old saves) fall back to cotton canvas. */
export const fabricById = (id: string) => BY_ID.get(id) ?? FALLBACK;

/** Fabrics in one category, in library order. */
export const fabricsIn = (c: FabricCategory) => FABRICS.filter((f) => f.category === c);

/** Anything that names a fabric and colour: PieceFabric, an attachment's fabric, an inside face. */
export interface FabricRef { id: string; color: number; hex?: string; pattern?: FabricPattern }

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The ground colour (CSS hex) of a piece fabric: its custom colour if set and valid, else the named colour on the card. */
export function fabricHex(pf: FabricRef): string {
  if (pf.hex && HEX.test(pf.hex)) return pf.hex.toLowerCase();
  const f = fabricById(pf.id);
  return (f.colors[pf.color] ?? f.colors[0]).hex;
}

/** Plain language colour name: the card name, the card name of a custom colour that matches one, or the hex. */
export function colorName(pf: FabricRef): string {
  const f = fabricById(pf.id);
  if (pf.hex && HEX.test(pf.hex)) {
    const hit = f.colors.find((c) => c.hex.toLowerCase() === pf.hex!.toLowerCase());
    return hit ? hit.name : `Custom ${pf.hex.toLowerCase()}`;
  }
  return (f.colors[pf.color] ?? f.colors[0]).name;
}

/**
 * Typical cloth thickness per fabric id (mm, at rest under a light presser foot, like a mill's thickness gauge).
 * Used for layer stacks (src/data/stack.ts): a lining or a stack of patches adds its thickness, weight and stiffness.
 */
const THICKNESS: Record<string, number> = {
  canvas: 0.6, denim: 0.8, 'stretch-denim': 0.7, poplin: 0.2, linen: 0.3, wool: 0.5, poly: 0.15, jersey: 0.5, rib: 0.9,
  leather: 1.2, spandex: 0.5, oxford: 0.3, chambray: 0.25, 'shirting-twill': 0.25, flannel: 0.6, seersucker: 0.35, voile: 0.1,
  'selvedge-denim': 1.0, 'raw-denim': 0.95, 'white-denim': 0.75, 'black-denim': 0.75, 'slub-jersey': 0.5, pique: 0.8,
  interlock: 0.7, 'french-terry': 1.2, fleece: 2.5, waffle: 1.5, modal: 0.4, duck: 0.8, ripstop: 0.15, 'nylon-taffeta': 0.1,
  softshell: 1.5, 'waxed-cotton': 0.6, corduroy: 1.3, moleskin: 0.8, melton: 2.0, tweed: 1.5, gabardine: 0.4, satin: 0.15,
  'silk-crepe': 0.15, velvet: 1.5, suede: 1.0, 'faux-leather': 0.8, mesh: 0.6, 'tech-stretch': 0.3,
};
/** Thickness of a fabric (mm). Unknown ids: estimated from weight (about 400 g/m2 per mm, like a medium woven). */
export const fabricThickness = (id: string) => THICKNESS[id] ?? Math.max(0.1, fabricById(id).gsm / 400);

/** Typical fibre content per fabric id, for the tech pack bill of materials. Typical values: the mill's spec sheet wins. */
const COMPOSITION: Record<string, string> = {
  canvas: '100% cotton', denim: '100% cotton', 'stretch-denim': '98% cotton, 2% elastane', poplin: '100% cotton', linen: '100% linen',
  wool: '100% wool', poly: '100% polyester', jersey: '100% cotton', rib: '95% cotton, 5% elastane', leather: 'Leather (cow hide)',
  spandex: '80% polyester, 20% elastane', oxford: '100% cotton', chambray: '100% cotton', 'shirting-twill': '100% cotton', flannel: '100% cotton',
  seersucker: '100% cotton', voile: '100% cotton', 'selvedge-denim': '100% cotton', 'raw-denim': '100% cotton', 'white-denim': '100% cotton',
  'black-denim': '100% cotton', 'slub-jersey': '100% cotton', pique: '100% cotton', interlock: '100% cotton', 'french-terry': '100% cotton',
  fleece: '80% cotton, 20% polyester', waffle: '100% cotton', modal: '100% modal (beech fibre)', duck: '100% cotton', ripstop: '100% nylon',
  'nylon-taffeta': '100% nylon', softshell: '92% polyester, 8% elastane', 'waxed-cotton': '100% cotton, wax coated', corduroy: '100% cotton',
  moleskin: '100% cotton', melton: '100% wool', tweed: '100% wool', gabardine: '100% cotton', satin: '100% polyester', 'silk-crepe': '100% silk',
  velvet: '100% polyester', suede: 'Suede (cow split)', 'faux-leather': 'Polyurethane on polyester knit', mesh: '100% polyester',
  'tech-stretch': '88% nylon, 12% elastane',
};
/** Typical composition of a fabric (see COMPOSITION). */
export const compositionOf = (id: string) => COMPOSITION[id] ?? 'Not specified';

export function stretchLabel(s: number) {
  if (s < 0.05) return 'Low stretch';
  if (s < 0.15) return 'Some stretch';
  return 'High stretch';
}

export { PATTERNS, PATTERN_IDS, patternTile, patternLabel, withPatternDefaults } from './patterns';
