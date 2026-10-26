import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Mesh,
  PlaneGeometry, Points, ShaderMaterial, CustomBlending, OneFactor, OneMinusDstColorFactor, ZeroFactor,
  DoubleSide, MeshBasicMaterial,
} from '@iwsdk/core';

/** Desktop's normalized1280×714 field, lifted into a16:9 world-space plane. */
export const ATMOSPHERE_ASPECT = 16 / 9;
export const ATMOSPHERE_COUNTS = { low: 0, medium: 98, high: 195 } as const;

const particleVertex = `
  attribute float aSeed;
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uViewportHeight;
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    vec3 p = position;
    float t = uTime;
    p.x += sin(t * .19 + aSeed * 32.) * .012;
    p.y = mod(p.y + t * (.005 + aSeed * .011) + 1., 1.);
    p.x += sin(p.y * 12. + t * .38 + aSeed * 50.) * .009;
    vec4 view = modelViewMatrix * vec4((p.x - .5) * 16., (p.y - .5) * 9., 0., 1.);
    gl_Position = projectionMatrix * view;
    float shimmer = .58 + .42 * sin(t * (1. + aSeed) + aSeed * 60.);
    float worldScale = length(modelViewMatrix[1].xyz);
    gl_PointSize = aSize * (.75 + shimmer * .25) * worldScale * 9. / 714.
      * uViewportHeight * .5 * projectionMatrix[1][1] / max(.01, -view.z);
    vColor = aColor;
    vOpacity = (.24 + shimmer * .61) * (.5 + position.z * .5);
  }
`;

// Exact desktop soft-halo/core/fleck math. No texture, bloom or extra render pass.
const particleFragment = `
  precision mediump float;
  uniform float uDim;
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    vec2 uv = gl_PointCoord - .5;
    float d = length(uv * vec2(1., 1.15));
    float halo = exp(-d * d * 21.) * .24;
    float core = exp(-d * d * 100.);
    float fleck = exp(-length(uv * vec2(1., .7)) * 19.) * .45;
    float a = (halo + core + fleck) * vOpacity * (1. - uDim * .8);
    if (a < .008) discard;
    gl_FragColor = vec4(vColor * 1.25, a);
  }
`;

const surfaceVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }
`;

const washFragment = `
  precision mediump float;
  uniform float uDim;
  varying vec2 vUv;
  void main() {
    vec2 uv = (vec2(vUv.x, 1. - vUv.y) - .5) * 4. + .5;
    float d = length((uv - vec2(.78, .30)) / vec2(1.1030866, .9899495));
    vec3 c = mix(vec3(.545098, .470588, .325490), vec3(.458824, .384314, .258824), clamp(d / .2, 0., 1.));
    c = mix(c, vec3(.376471, .313725, .203922), clamp((d - .2) / .19, 0., 1.));
    c = mix(c, vec3(.254902, .2, .121569), clamp((d - .39) / .22, 0., 1.));
    c = mix(c, vec3(.066667, .050980, .035294), clamp((d - .61) / .35, 0., 1.));
    c *= 1. - .49 * clamp(1. - uv.x / .62, 0., 1.);
    float vignette = clamp((length((uv - vec2(.54, .58)) / vec2(.763675, .820244)) - .15) / .85, 0., 1.);
    c = mix(c, vec3(.035294, .027451, .019608), vignette * .17);
    gl_FragColor = vec4(c * (1. - uDim * .72), 1.);
  }
`;

const auraFragment = `
  precision mediump float;
  uniform float uTime;
  uniform float uDim;
  varying vec2 vUv;
  float aura(vec2 uv, vec2 center, vec2 radius, float end) {
    return clamp(1. - length((uv - center) / radius) / end, 0., 1.);
  }
  void main() {
    vec2 uv = vec2(vUv.x, 1. - vUv.y);
    float breathe = .825 - .175 * cos(uTime * .698131701);
    vec3 first = vec3(.447059, .960784, .819608) * .168627
      * aura(uv, vec2(.83, .20), vec2(.24, .29), .82);
    vec3 second = vec3(.831373, .701961, .415686) * .160784
      * aura(uv, vec2(.96, .43), vec2(.24, .47), .83);
    vec3 third = vec3(.321569, .815686, .721569) * .121569
      * aura(uv, vec2(.98, .52), vec2(.15, .34), .9);
    vec3 screen = 1. - (1. - first) * (1. - second) * (1. - third);
    gl_FragColor = vec4(screen * breathe * (1. - uDim * .85), 0.);
  }
`;

function particleGeometry(count: number): BufferGeometry {
  let randomState = 46207;
  const random = () => {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const color = new Color();
  for (let i = 0; i < count; i++) {
    const isSpirit = i < count * .82;
    let x = random(), y = random();
    if (i < count * .39) { x = .66 + x * .33; y = .63 + y * .35; }
    else if (i < count * .52) { x = .5 + x * .09; y = .54 + y * .27; }
    else if (isSpirit) x = .88 + x * .12;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = random();
    seeds[i] = random();
    sizes[i] = isSpirit ? 9 + random() * 27 : 2.2 + random() * 7;
    color.set(isSpirit ? '#71e7cf' : '#bb8d51');
    if (isSpirit && i % 5 === 0) color.set('#b4e9ce');
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  return geometry;
}

/** Parentless manifest prototype. Origin=center; +Yup,+Zviewer; envelope16×9m. */
export function createAtmosphereAsset(): Group {
  const root = new Group();
  root.name = 'Crownfall Desktop Atmosphere';
  const plane = new PlaneGeometry(16, 9);
  const widePlane = new PlaneGeometry(64, 36);
  const uniforms = () => ({ uTime: { value: 0 }, uDim: { value: 0 } });
  // Extend only the wash; UV remapping retains the original central16×9 gradient.
  const wash = new Mesh(widePlane, new ShaderMaterial({
    vertexShader: surfaceVertex, fragmentShader: washFragment, uniforms: uniforms(),
    depthTest: false, depthWrite: false, toneMapped: false,
  }));
  wash.name = 'Desktop Warm Wash'; wash.renderOrder = -1000;
  root.add(wash);
  const aura = new Mesh(plane, new ShaderMaterial({
    vertexShader: surfaceVertex, fragmentShader: auraFragment, uniforms: uniforms(),
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    blending: AdditiveBlending,
  }));
  aura.material.blending = CustomBlending;
  aura.material.blendSrc = OneMinusDstColorFactor; aura.material.blendDst = OneFactor;
  aura.material.blendSrcAlpha = ZeroFactor; aura.material.blendDstAlpha = OneFactor;
  aura.name = 'Desktop Spirit Aura'; aura.renderOrder = -20;
  root.add(aura);
  const material = new ShaderMaterial({
    vertexShader: particleVertex, fragmentShader: particleFragment,
    uniforms: { ...uniforms(), uViewportHeight: { value: 714 } },
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    blending: AdditiveBlending,
  });
  for (const quality of ['medium', 'high'] as const) {
    const points = new Points(particleGeometry(ATMOSPHERE_COUNTS[quality]), material);
    points.name = `Desktop Motes ${quality}`;
    points.renderOrder = -10; points.frustumCulled = false;
    points.visible = quality === 'medium';
    root.add(points);
  }
  const veil = new Mesh(widePlane, new MeshBasicMaterial({
    color: 0x0a0805, transparent: true, opacity: 0, depthWrite: false,
    toneMapped: false, side: DoubleSide,
  }));
  veil.name = 'Desktop Scene Veil'; veil.renderOrder = -1; veil.visible = false;
  root.add(veil);
  return root;
}

export default createAtmosphereAsset();
