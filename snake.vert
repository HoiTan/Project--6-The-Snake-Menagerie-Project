#version 330 compatibility

uniform float	Timer;
uniform float	uAmp;
uniform float	uFreq;

out vec2 vST; // texture coords
out vec3 vN; // normal vector
out vec3 vL; // vector from point to light
out vec3 vE; // vector from point to eye
out float vNz; // z-component of normal
const vec3 LIGHTPOS = vec3( 5.,10.,10.);

const float 	PI 		= 3.14159265;
const float	TWOPI 	= 2.*PI;
const float	LENGTH 	= 5.;
void
main()
{
    vST = gl_MultiTexCoord0.st;
    vN = normalize( gl_NormalMatrix * gl_Normal ); // normal vector
    vNz = normalize( gl_NormalMatrix * gl_Normal ).z;

    vec3 vert = gl_Vertex.xyz;
    vert.z += uAmp * sin( TWOPI*( Timer +(uFreq*vert.x/LENGTH) ) );

    vec4 ECposition = gl_ModelViewMatrix * vec4( vert, 1. );

    vL = LIGHTPOS - ECposition.xyz; // vector from the point
    // to the light position
    vE = vec3( 0., 0., 0. ) - ECposition.xyz; // vector from the point
    // to the eye position
    gl_Position = gl_ModelViewMatrix * vec4( vert, 1. );
}