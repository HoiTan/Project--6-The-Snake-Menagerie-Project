#version 330 core

// ----------------------------------------------------
// To select the pass you want at compile time, define:
//   #define PASS 1  // or 2, or 3
// (You can do this in your build script or via #ifdef.)
// ----------------------------------------------------

// ---------- Shared Code (used by all passes) ----------
uniform vec2  iResolution;  // (width, height)
uniform float iTime;        // time in seconds
uniform vec4  iMouse;       // (x, y, clickState, ?)

// For passes that need textures, we declare them here.
// Some passes won't use them, but won't cause an error if they aren't bound.
uniform sampler2D gbuffer;   // From pass 1
uniform sampler2D edgeTex;   // From pass 2
uniform sampler2D noiseTex;  // For final stylization

in vec2 vUV;           // from vertex shader
out vec4 FragColor;    // final output color

// Some typical defines (matching the original code):
#define PRECIS 0.001
#define DMAX   20.0

// For normal & depth comparisons in pass 2
#define SENSITIVITY_NORMAL 0.3
#define SENSITIVITY_DEPTH  1.5

// For final pass stylization
#define EdgeColor        vec4(0.2, 0.2, 0.15, 1.0)
#define BackgroundColor  vec4(1.0, 0.95, 0.85, 1.0)
#define NoiseAmount      0.01
#define ErrorPeriod      30.0
#define ErrorRange       0.003

// Light direction
vec3 lightDir = normalize(vec3(5.0, 5.0, -4.0));

// ----------------- Distance Field Functions -----------------
float fSubtraction(float a, float b) { return max(-a,b); }
float fIntersection(float d1, float d2) { return max(d1,d2); }
void  fUnion(inout float d1, float d2) { d1 = min(d1,d2); }

float pSphere(vec3 p, float s) { return length(p) - s; }

float pRoundBox(vec3 p, vec3 b, float r)
{
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) - r;
}

float pTorus(vec3 p, vec2 t)
{
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

float pTorus2(vec3 p, vec2 t)
{
    vec2 q = vec2(length(p.xy) - t.x, p.z);
    return length(q) - t.y;
}

float pCapsule(vec3 p, vec3 a, vec3 b, float r)
{
    vec3 pa = p - a;
    vec3 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

// --------------- Scene SDF ---------------
float mapScene(vec3 p)
{
    float d = 100000.0;

    fUnion(d, pRoundBox(p - vec3(0,  -2.0,  0),  vec3(4, 0.1, 4), 0.2));
    fUnion(d, pSphere   (p - vec3(2,   0,    2),  1.5));
    fUnion(d, pSphere   (p - vec3(3.5,-1.0,  0),  0.8));
    fUnion(d, pTorus    (p - vec3(-2,  0,    2),  vec2(1, 0.3)));
    fUnion(d, pTorus2   (p - vec3(-3,  0,    2),  vec2(1, 0.3)));
    fUnion(d, pRoundBox (p - vec3(2,   0.6, -2),  vec3(0.1,0.1,1), 0.3));
    fUnion(d, pRoundBox (p - vec3(2,   0,   -2),  vec3(0.1,1.5,0.1), 0.3));
    fUnion(d, pRoundBox (p - vec3(2,  -0.4, -2),  vec3(1.2,0.1,0.1), 0.3));
    fUnion(d, pCapsule  (p, vec3(-2, 1.5,-2), vec3(-2, -1, -1.0), 0.3));
    fUnion(d, pCapsule  (p, vec3(-2, 1.5,-2), vec3(-1.0,-1, -2.5), 0.3));
    fUnion(d, pCapsule  (p, vec3(-2, 1.5,-2), vec3(-3.0,-1, -2.5), 0.3));

    return d;
}

// --------------- Normal, Shadow, Raymarch ---------------
vec3 calcNormal(vec3 pos)
{
    vec2 e = vec2(0.001, 0.0);
    float d1 = mapScene(pos + e.xyy) - mapScene(pos - e.xyy);
    float d2 = mapScene(pos + e.yxy) - mapScene(pos - e.yxy);
    float d3 = mapScene(pos + e.yyx) - mapScene(pos - e.yyx);
    return normalize(vec3(d1, d2, d3));
}

float shadowFunction(vec3 ro, vec3 rd)
{
    float res = 1.0;
    float t   = PRECIS * 30.0;
    for(int i = 0; i < 30; i++)
    {
        float distToSurf = mapScene(ro + rd * t);
        res = min(res, 8.0 * distToSurf / t);
        t  += distToSurf;
        if(distToSurf < PRECIS || t > DMAX) break;
    }
    return clamp(res, 0.0, 1.0);
}

vec4 raymarching(vec3 ro, vec3 rd)
{
    float t = 0.0;
    for(int i = 0; i < 50; i++)
    {
        float distToSurf = mapScene(ro + rd * t);
        t += distToSurf;
        if(distToSurf < PRECIS || t > DMAX) break;
    }

    // if t > DMAX, no hit
    if(t > DMAX)
    {
        // store "far" depth = 0 in our scheme (or 1.0, depends on how we interpret)
        // The original code used 1.0 - (t/DMAX) for depth => no hit means 0
        return vec4(0.0, 0.0, 0.0, 0.0);
    }

    vec3 pos = ro + rd * t;
    vec3 nor = calcNormal(pos);

    float depth = 1.0 - (t / DMAX); // in [0..1], near->1, far->0

    // Encode normal.x, normal.y into [0..1]
    vec2 norEncoded = nor.xy * 0.5 + 0.5;

    // Diffuse lighting
    float diff = max(0.0, dot(nor, lightDir)) * 0.5 + 0.5;
    diff *= shadowFunction(pos, lightDir);

    // xy = normal, z = depth, w = diffuse
    return vec4(norEncoded, depth, diff);
}

// --------------- Simple Camera ---------------
mat3 setCamera(vec3 ro, vec3 ta, float roll)
{
    vec3 cw = normalize(ta - ro);
    vec3 cp = vec3(sin(roll), cos(roll), 0.0);
    vec3 cu = normalize(cross(cw, cp));
    vec3 cv = normalize(cross(cu, cw));
    return mat3(cu, cv, cw);
}

// --------------- Pass 2 Edge Checking ---------------
float checkSame(vec4 c, vec4 s)
{
    // c.xy = normal, c.z = depth
    // s.xy = normal, s.z = depth
    vec2 cn = c.xy;
    vec2 sn = s.xy;
    float cd = c.z;
    float sd = s.z;

    vec2 diffNorm = abs(cn - sn) * SENSITIVITY_NORMAL;
    bool sameNorm = (diffNorm.x + diffNorm.y) < 0.1;

    float diffDepth = abs(cd - sd) * SENSITIVITY_DEPTH;
    bool sameDepth  = diffDepth < 0.1;

    return (sameNorm && sameDepth) ? 1.0 : 0.0;
}

// --------------- Final pass glitch/noise helpers ---------------
float triangleWave(float x)
{
    // a triangle wave in range -1..1
    return abs(1.0 - mod(abs(x), 2.0)) * 2.0 - 1.0;
}

float rand1D(float x)
{
    return fract(sin(x) * 43758.5453);
}


// ==================================
// =========== PASS #1 ==============
// ==================================
#if PASS == 1

void main()
{
    // We'll map vUV to Shadertoy style coords
    vec2 fragCoord = vUV * iResolution;
    vec2 p = (2.0 * fragCoord - iResolution) / iResolution.y;

    // Optional mouse transform
    vec2 mo = vec2(0.0);
    if(iMouse.z > 0.0)
        mo += (2.0 * iMouse.xy - iResolution) / iResolution.y;

    // Camera setup
    float dist  = 6.5;
    vec3 ro     = vec3(
        dist * cos(iTime * 0.1 + 6.0 * mo.x),
        2.0 + mo.y * 4.0,
        dist * sin(iTime * 0.1 + 6.0 * mo.x)
    );
    vec3 target = vec3(0.0, 0.0, 0.0);
    mat3 camMat = setCamera(ro, target, 0.0);

    // Ray direction
    vec3 rd = camMat * normalize(vec3(p, 1.5));

    // Raymarch
    FragColor = raymarching(ro, rd);

    // Output ( r=normal.x, g=normal.y, b=depth, a=diffuse )
}

#endif // PASS == 1


// ==================================
// =========== PASS #2 ==============
// ==================================
#if PASS == 2

void main()
{
    vec2 texel = 1.0 / iResolution;

    // Sample our G-buffer from pass 1
    vec4 center = texture(gbuffer, vUV);
    vec4 s1     = texture(gbuffer, vUV + texel * vec2( 1.0,  1.0));
    vec4 s2     = texture(gbuffer, vUV + texel * vec2(-1.0, -1.0));
    vec4 s3     = texture(gbuffer, vUV + texel * vec2(-1.0,  1.0));
    vec4 s4     = texture(gbuffer, vUV + texel * vec2( 1.0, -1.0));

    float edge = checkSame(s1, s2) * checkSame(s3, s4);

    // We'll keep the .w from pass 1 (the diffuse) in the g-channel
    float diff = center.w;

    // Pass out: R=edge(1=inside,0=edge), G=diffuse, B=1, A=1
    FragColor = vec4(edge, diff, 1.0, 1.0);
}

#endif // PASS == 2


// ==================================
// =========== PASS #3 ==============
// ==================================
#if PASS == 3

void main()
{
    // Slight “time-quantization” to get that jumpy effect
    float time = floor(iTime * 16.0) / 16.0;

    // Start with base UV
    vec2 uv = vUV;

    // Subtle glitch offset
    uv += vec2(
        triangleWave(uv.y * rand1D(time)) * rand1D(time * 1.9) * 0.005,
        triangleWave(uv.x * rand1D(time * 3.4)) * rand1D(time * 2.1) * 0.005
    );

    // Sample from noiseTex
    float noiseVal = texture(noiseTex, uv * 0.5).r - 0.5;
    noiseVal *= NoiseAmount;

    // Create 3 slightly shifted UVs
    vec2 uvR = uv + vec2(
        ErrorRange * sin(ErrorPeriod * uv.y + 0.0) + noiseVal,
        ErrorRange * sin(ErrorPeriod * uv.x + 0.0) + noiseVal
    );
    vec2 uvG = uv + vec2(
        ErrorRange * sin(ErrorPeriod * uv.y + 1.047) + noiseVal,
        ErrorRange * sin(ErrorPeriod * uv.x + 3.142) + noiseVal
    );
    vec2 uvB = uv + vec2(
        ErrorRange * sin(ErrorPeriod * uv.y + 2.094) + noiseVal,
        ErrorRange * sin(ErrorPeriod * uv.x + 1.571) + noiseVal
    );

    // edgeTex from pass 2
    float edgeR = texture(edgeTex, uvR).r;
    float edgeG = texture(edgeTex, uvG).r;
    float edgeB = texture(edgeTex, uvB).r;

    // If all three are interior => 1.0; if any is 0 => edge
    float edgeVal = edgeR * edgeG * edgeB;

    // Also get diffuse from the center
    float diffuse = texture(edgeTex, uv).g;

    // We do a small threshold on diffuse to fade from darker to lighter
    float w = fwidth(diffuse) * 2.0;
    vec4 midColor = mix(
        BackgroundColor * 0.5,
        BackgroundColor,
        smoothstep(-w, w, diffuse - 0.3)
    );

    // Where edgeVal=0 => EdgeColor, else midColor
    FragColor = mix(EdgeColor, midColor, edgeVal);
}

#endif // PASS == 3
