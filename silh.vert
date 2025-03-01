#version 330 compatibility
out vec2 vST; // texture coords
out vec3 vN; // normal vector
out vec3 vL; // vector from point to light
out vec3 vE; // vector from point to eye
out float vNz; // z-component of normal
const vec3 LIGHTPOS = vec3( 5.,10.,10.);
void
main()
{
    vST = gl_MultiTexCoord0.st;
    vN = normalize( gl_NormalMatrix * gl_Normal ); // normal vector
    vNz = normalize( gl_NormalMatrix * gl_Normal ).z;
    vec4 ECposition = gl_ModelViewMatrix * gl_Vertex;
    vL = LIGHTPOS - ECposition.xyz; // vector from the point
    // to the light position
    vE = vec3( 0., 0., 0. ) - ECposition.xyz; // vector from the point
    // to the eye position
    gl_Position = gl_ModelViewProjectionMatrix * gl_Vertex;
}