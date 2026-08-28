#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_BLUEPRINTS,
  talentBlueprintAvatar,
  talentBlueprintIsCurated,
} from "../src/talent-blueprints.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const MAX_PORTRAIT_BYTES = 64 * 1024;
const PORTRAIT_EDGE = 256;

function webpFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return webpFiles(path);
    return entry.isFile() && entry.name.endsWith(".webp") ? [path] : [];
  });
}

function webpDimensions(buffer) {
  if (
    buffer.length < 20
    || buffer.toString("ascii", 0, 4) !== "RIFF"
    || buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("not a RIFF WebP image");
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const kind = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (payload + chunkSize > buffer.length) throw new Error(`truncated ${kind || "WebP"} chunk`);
    if (kind === "VP8X") {
      if (chunkSize < 10) throw new Error("invalid VP8X header");
      return {
        width: buffer.readUIntLE(payload + 4, 3) + 1,
        height: buffer.readUIntLE(payload + 7, 3) + 1,
      };
    }
    if (kind === "VP8 ") {
      if (
        chunkSize < 10
        || buffer[payload + 3] !== 0x9d
        || buffer[payload + 4] !== 0x01
        || buffer[payload + 5] !== 0x2a
      ) throw new Error("invalid VP8 frame header");
      return {
        width: buffer.readUInt16LE(payload + 6) & 0x3fff,
        height: buffer.readUInt16LE(payload + 8) & 0x3fff,
      };
    }
    if (kind === "VP8L") {
      if (chunkSize < 5 || buffer[payload] !== 0x2f) throw new Error("invalid VP8L frame header");
      const dimensions = buffer.readUInt32LE(payload + 1);
      return {
        width: (dimensions & 0x3fff) + 1,
        height: ((dimensions >>> 14) & 0x3fff) + 1,
      };
    }
    offset = payload + chunkSize + (chunkSize % 2);
  }
  throw new Error("WebP image has no supported frame header");
}

const HERITAGES = [
  "East Asian", "Black", "South Asian", "Southeast Asian", "Latino", "Middle Eastern",
  "white", "Central Asian", "mixed-heritage", "Pacific Islander", "North African", "Indigenous Latin American",
];
const PRESENTATIONS = ["woman", "man", "nonbinary adult"];
const AGES = [
  "late 20s", "early 30s", "mid 30s", "late 30s", "early 40s", "mid 40s",
  "late 40s", "early 50s", "mid 50s", "late 50s", "early 60s",
];
const FACE_SHAPES = [
  "oval", "square", "long", "heart-shaped", "round", "angular", "broad", "diamond-shaped",
];
const HAIR = [
  "short natural curls", "a neat shoulder-length bob", "a textured crop", "long braids tied low",
  "a salt-and-pepper side part", "a close buzz cut", "a loose wavy lob", "a swept-back undercut",
  "a curly high puff", "a silver pixie cut", "long straight hair in a low ponytail", "a shaved head",
  "a soft layered shag", "short locs", "a neat chin-length cut", "a wavy side part",
  "a coiled tapered cut", "a gray braided crown", "a cropped quiff", "a shoulder-length twist-out",
];
const EXPRESSIONS = [
  "calm observant expression", "focused half-smile", "warm confident expression",
  "thoughtful direct gaze", "quietly energetic expression", "steady reassuring expression",
  "curious analytical gaze", "composed decisive expression", "approachable attentive expression",
  "wry intelligent half-smile",
];
const DETAILS = [
  "subtle freckles", "a small eyebrow scar", "a single cheek dimple", "fine laugh lines",
  "round glasses", "rectangular glasses", "a neat short beard", "a narrow mustache",
  "small geometric earrings", "a simple ear cuff", "no facial hair or eyewear", "a faint beauty mark",
];
const WARDROBE_BASES = [
  "charcoal black", "deep navy", "rust brown", "forest olive", "dark burgundy", "slate blue",
  "aubergine", "deep teal", "ink gray", "burnt sienna", "midnight blue", "moss green",
];

const DEPARTMENT_VISUALS = {
  academic: {
    wardrobes: ["a tweed waistcoat over a rolled-sleeve Oxford shirt", "a soft shawl cardigan over a fine-gauge turtleneck", "a long linen professor coat over an open-collar shirt"],
    props: ["one closed research notebook", "a specimen card with abstract shapes", "a small archival magnifier"],
  },
  design: {
    wardrobes: ["an asymmetric color-block overshirt", "a sculptural sleeveless knit over a crisp blouse", "a minimal black turtleneck with one vivid artist scarf"],
    props: ["a material swatch fan", "one broad drawing stylus", "a tiny folded color study"],
  },
  engineering: {
    wardrobes: ["a sleeveless technical vest over a fitted hoodie", "a rolled-sleeve chambray work shirt with one slim tool loop", "a cropped utility chore coat over a clean mock neck", "a knit polo with a lightweight modular chest pocket"],
    props: ["a tiny abstract component tile", "one compact terminal device", "a narrow circuit sample without symbols"],
  },
  finance: {
    wardrobes: ["a sharp pinstripe waistcoat over a crisp shirt", "a silk-neck blouse with restrained geometric tailoring", "a fitted knit polo under a collarless blazer"],
    props: ["a slim ledger folder", "one compact calculator without markings", "a small brass balance token"],
  },
  "game-development": {
    wardrobes: ["a color-block studio bomber over a soft tee", "a relaxed cardigan with one playful enamel shape", "a sleeveless hoodie under a short creative overshirt"],
    props: ["a tiny controller-shaped object", "one abstract level tile", "a miniature articulated character maquette"],
  },
  gis: {
    wardrobes: ["a field vest over a merino base layer", "a sun-faded expedition shirt with rolled sleeves", "a weatherproof capelet over a smart knit top"],
    props: ["a folded contour map without labels", "one compact compass", "a palm-sized terrain model"],
  },
  healthcare: {
    wardrobes: ["a clean collarless clinical tunic", "a soft scrub top under a fine cardigan", "a crisp consultation shirt with one rolled sleeve"],
    props: ["a patient-safe clipboard without writing", "one diagnostic reference card with abstract shapes", "a compact examination light"],
  },
  leadership: {
    wardrobes: ["a refined double-breasted suit with understated tailoring", "a silk shirt under a long sleeveless vest", "a premium open-collar knit with a single statement pin"],
    props: ["a closed decision notebook", "one abstract strategy tile", "a small brass compass token"],
  },
  legal: {
    wardrobes: ["a precise dark three-piece suit", "a high-neck blouse with a long tailored waistcoat", "a crisp band-collar shirt beneath a formal robe-inspired coat"],
    props: ["a slim case folder without text", "one brass bookmark", "a compact document seal with no letters"],
  },
  marketing: {
    wardrobes: ["a patterned silk bomber over a monochrome top", "a bold draped blouse with an asymmetric collar", "a clean mock neck under a cropped creative vest"],
    props: ["a tiny campaign storyboard card without text", "one pocket sketchbook", "a small megaphone-shaped desk object"],
  },
  "paid-media": {
    wardrobes: ["a sharp color-block media vest over a rolled-sleeve shirt", "a sleek zip-neck knit with a bright shoulder panel", "a structured sleeveless blazer over a plain tee"],
    props: ["a tiny channel planning board without text", "one marker", "an abstract target dial"],
  },
  people: {
    wardrobes: ["a warm textured cardigan over a soft shirt", "a relaxed wrap blouse with a narrow belt", "a collarless soft-tailored vest over a fine knit"],
    props: ["an onboarding folder without writing", "one conversation card with abstract shapes", "a small welcome token"],
  },
  product: {
    wardrobes: ["a practical canvas overshirt over a striped knit", "a clean quarter-zip sweater with rolled sleeves", "a sleeveless product vest over a band-collar shirt"],
    props: ["a roadmap card with abstract blocks", "one pocket notebook", "a small modular prototype"],
  },
  "project-management": {
    wardrobes: ["a structured shirt dress with utility belt", "a neat sweater vest over a rolled-sleeve shirt", "a short delivery smock with contrasting pockets"],
    props: ["a milestone deck without text", "one mechanical pencil", "a compact magnetic planning tile"],
  },
  sales: {
    wardrobes: ["a polished open-collar suit with a pocket square", "a fitted roll-neck under a suede vest", "a crisp shirt with suspenders and rolled sleeves"],
    props: ["a proposal folder without writing", "one abstract relationship map card", "a small handshake-shaped token"],
  },
  security: {
    wardrobes: ["a dark protective technical vest over a high collar", "a fitted black field shirt with reinforced shoulders", "a minimal hooded shell with one reflective seam"],
    props: ["a small trust-boundary tile", "one inspection light", "a compact shield-shaped object without a logo"],
  },
  "spatial-computing": {
    wardrobes: ["a minimal sleeveless future-facing tunic", "an iridescent cropped overshirt over a black mock neck", "a clean technical wrap top with an asymmetric shoulder"],
    props: ["one translucent spatial model tile", "a tiny wireframe orb", "a compact gesture controller"],
  },
  specialized: {
    wardrobes: ["a distinctive role-appropriate vest over a plain shirt", "a dramatic long overshirt with one asymmetric closure", "a textured knit with a single profession-inspired accessory"],
    props: ["one restrained role-specific tool", "a compact notebook without writing", "a small abstract symbol of the profession"],
  },
  "supply-chain": {
    wardrobes: ["a durable high-visibility operations vest over a dark shirt", "a hard-wearing denim apron over rolled sleeves", "a clean logistics polo with a cross-body utility strap"],
    props: ["a routing manifest without writing", "one miniature package token", "a small barcode-free inventory scanner"],
  },
  support: {
    wardrobes: ["an approachable knit polo with contrasting collar", "a soft cardigan over a practical service shirt", "a lightweight headset vest over a rolled-sleeve blouse"],
    props: ["a case notebook without writing", "one compact headset held low", "a small conversation-status tile"],
  },
  testing: {
    wardrobes: ["a practical lab smock with contrasting seams", "a quilted quality vest over a clean crew neck", "a rolled-sleeve inspection shirt with a narrow harness pocket"],
    props: ["a test checklist card without text", "one inspection loupe", "a small calibration cube"],
  },
};

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function appearance(blueprint, index) {
  const hash = stableHash(`${blueprint.id}\0${blueprint.username}`);
  const heritage = HERITAGES[(index * 5 + hash) % HERITAGES.length];
  const presentation = PRESENTATIONS[(index + (hash >>> 4)) % PRESENTATIONS.length];
  const age = AGES[(index * 3 + (hash >>> 7)) % AGES.length];
  const face = FACE_SHAPES[(index * 5 + (hash >>> 11)) % FACE_SHAPES.length];
  const hair = HAIR[(index * 7 + (hash >>> 13)) % HAIR.length];
  const expression = EXPRESSIONS[(index * 3 + (hash >>> 17)) % EXPRESSIONS.length];
  const detail = DETAILS[(index * 7 + (hash >>> 19)) % DETAILS.length];
  const wardrobeBase = WARDROBE_BASES[(index * 11 + (hash >>> 9)) % WARDROBE_BASES.length];
  const visual = DEPARTMENT_VISUALS[blueprint.department] ?? DEPARTMENT_VISUALS.specialized;
  const wardrobe = visual.wardrobes[(index * 3 + (hash >>> 21)) % visual.wardrobes.length];
  const prop = visual.props[(index * 5 + (hash >>> 23)) % visual.props.length];
  return { heritage, presentation, age, face, hair, expression, detail, wardrobeBase, wardrobe, prop };
}

function promptFor(blueprint, index) {
  const look = appearance(blueprint, index);
  return `Use case: stylized-concept
Asset type: square Hara Agent profile portrait for desktop talent marketplace, chat list, profile, and office character head
Input images: the supplied Hara portraits are style references only; never copy their identities
Primary request: Create ${blueprint.name.en}, a ${blueprint.title.en}. ${blueprint.bio.en}
Subject: one distinct ${look.heritage} ${look.presentation} in their ${look.age}, ${look.face} face, ${look.hair}, ${look.expression}, ${look.detail}, wearing ${look.wardrobe}, holding ${look.prop}; adapt the prop subtly to the ${blueprint.title.en} role without adding text
Style/medium: premium hand-painted editorial comic illustration with softly textured brushwork, clean confident contour lines, credible adult anatomy, warm expressive face, polished social-RPG character art; match the visual language and finish of the supplied references
Composition/framing: centered head-and-upper-torso portrait, slight three-quarter pose, full hair and shoulders visible, generous safe margin, readable at 32px, one person only
Scene/backdrop: simple solid warm cream background (#F1DEC1), no pattern, no frame
Lighting/mood: soft warm studio light, capable, individual, trustworthy
Color palette: the wardrobe's dominant base color is ${look.wardrobeBase}; use ${blueprint.accent} only as a smaller secondary accent; warm cream is reserved for the background and must not become the default clothing color
Constraints: exactly one clearly unique adult character; no text, letters, numbers, UI, badge, logo, watermark, checkerboard, transparency, pixel art, chibi, anime, low-poly 3D, photorealism, duplicated body parts, cropped head, or clutter`;
}

const jobs = AGENT_BLUEPRINTS.map((blueprint, index) => {
  const avatar = talentBlueprintAvatar(blueprint);
  const outputPath = `${root}/public${avatar}`;
  const present = existsSync(outputPath);
  return {
    index,
    id: blueprint.id,
    username: blueprint.username,
    department: blueprint.department,
    name: blueprint.name,
    title: blueprint.title,
    avatar,
    outputPath,
    curated: talentBlueprintIsCurated(blueprint),
    present,
    bytes: present ? statSync(outputPath).size : 0,
    prompt: promptFor(blueprint, index),
  };
});

const duplicateAvatars = [...new Set(jobs.map((job) => job.avatar).filter((avatar, index, all) => all.indexOf(avatar) !== index))];
if (duplicateAvatars.length) throw new Error(`Duplicate Talent avatar paths: ${duplicateAvatars.join(", ")}`);

const args = process.argv.slice(2);
const mode = args[0] ?? "--summary";
if (mode === "--summary") {
  console.log(JSON.stringify({
    total: jobs.length,
    curated: jobs.filter((job) => job.curated).length,
    present: jobs.filter((job) => job.present).length,
    missing: jobs.filter((job) => !job.present).length,
    missingCurated: jobs.filter((job) => job.curated && !job.present).length,
    oversized: jobs.filter((job) => job.bytes > MAX_PORTRAIT_BYTES).map((job) => job.username),
  }, null, 2));
} else if (mode === "--missing") {
  console.log(JSON.stringify(jobs.filter((job) => !job.present), null, 2));
} else if (mode === "--all") {
  console.log(JSON.stringify(jobs, null, 2));
} else if (mode === "--next") {
  console.log(JSON.stringify(jobs.find((job) => !job.present) ?? null, null, 2));
} else if (mode === "--job") {
  const username = args[1];
  const job = jobs.find((item) => item.username === username);
  if (!job) throw new Error(`Unknown Talent username: ${username ?? ""}`);
  console.log(JSON.stringify(job, null, 2));
} else if (mode === "--validate") {
  const missing = jobs.filter((job) => !job.present);
  const oversized = jobs.filter((job) => job.present && job.bytes > MAX_PORTRAIT_BYTES);
  const expectedFiles = new Set(jobs.map((job) => resolve(job.outputPath)));
  const unexpected = webpFiles(resolve(root, "public/avatars/talent"))
    .filter((path) => !expectedFiles.has(path));
  const invalid = [];
  const wrongDimensions = [];
  const digestOwners = new Map();
  for (const job of jobs.filter((candidate) => candidate.present && candidate.bytes <= MAX_PORTRAIT_BYTES)) {
    try {
      const image = readFileSync(job.outputPath);
      const dimensions = webpDimensions(image);
      if (dimensions.width !== PORTRAIT_EDGE || dimensions.height !== PORTRAIT_EDGE) {
        wrongDimensions.push(`${job.username}:${dimensions.width}x${dimensions.height}`);
      }
      const digest = createHash("sha256").update(image).digest("hex");
      const owners = digestOwners.get(digest) ?? [];
      owners.push(job.username);
      digestOwners.set(digest, owners);
    } catch (error) {
      invalid.push(`${job.username}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const duplicates = [...digestOwners.values()].filter((owners) => owners.length > 1);
  if (
    missing.length
    || oversized.length
    || unexpected.length
    || invalid.length
    || wrongDimensions.length
    || duplicates.length
  ) {
    throw new Error(
      `Talent portraits incomplete: ${missing.length} missing, ${oversized.length} oversized, `
      + `${unexpected.length} unexpected, ${invalid.length} invalid, ${wrongDimensions.length} wrong-size, `
      + `${duplicates.length} duplicate group(s)`,
    );
  }
  const packaged = jobs.filter((job) => job.present).length;
  console.log(
    `Talent portraits OK: ${packaged}/${jobs.length} unique ${PORTRAIT_EDGE}x${PORTRAIT_EDGE} WebP assets, `
    + "no missing, unexpected, invalid, or oversized files",
  );
} else {
  throw new Error("usage: talent-avatar-queue.mjs [--summary|--all|--missing|--next|--job USERNAME|--validate]");
}
