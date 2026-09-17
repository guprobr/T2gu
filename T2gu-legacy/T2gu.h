/* Welcome to T2gu 0.5 source code! */
char verzione[255] = "T2gu engine v0.5.11";

#include <stdio.h>
#include <math.h>
#include <time.h>
#include <SDL2/SDL.h>
#include <SDL2/SDL_image.h>
#include <SDL2/SDL_ttf.h>
#include <SDL2/SDL_mixer.h>

int K;
#define DESBUG          1

////////////////////////// max index definitions of everything that matters

#define N_CARTOLA   25000 // maximum shitz, gonna write ins_cartola to dyn alloc?
#define NTRUPY 64          //  party[] max
#define NBAG    50          // inventory max size
#define N_ITENS 24          //  inventory[] max types
#define N_CRI 29            //  Livro[] creatures max types
#define N_MODEL 6             //  ? prefabs test see mkModels.c .sh
#define N_SIMBS 12          // for T4c scripts BLOCKS
#define N_FUNCTIONS 52      // for  scripts FUNCTIONS
#define SKINNER     18   // PLAYER sprite INDEX (see: img/cri.png 50x50 )


/////////////////// screen stuff
#define qTO             72     // basic sprite size in px
 /* #define SCREEN_WIDTH	1920
  #define SCREEN_HEIGHT   1080 */
#define SCREEN_WIDTH	1024
#define SCREEN_HEIGHT   768
#define FARAWAY   (SCREEN_HEIGHT)/(qTO) // how much screen to draw (the bigger, less tiles)
#define STEP            0.2 // basic movement increment between tiles

unsigned int QTO = qTO;         // size of pixels current ZOOM
int bigW = SCREEN_WIDTH;
int bigH = SCREEN_HEIGHT;
int ALOHA = FARAWAY;            // the greater ALOHA more tiles will draw
int ZZy = 1;    // (?)
/////////////////////////////////////////////////////////////////////////////////////
char Lux=3;                             // initial Sun position
unsigned char spiel=100;              // BLUE intensity main pallette
unsigned long int dayO = 1; // initial calendar position
unsigned char rainy=0;   // toggles default 'rain' condition ON/OFF (see: pUddlelings)
unsigned char SANDMAN=1; // toggles collector of corpses (removes dead units to free cartola)
//CFG #######################################
#define Solaris 5   // increment of Lux each tick
#define WAKKA   1   // sprite resize multiplier factor
#define GANGHO  6    //  "z-axis" max tile increment
#define PUDDLES 21    // water volume multiplier factor
#define TICKZ   33    // basic engine timer ticks
#define WHEE    11      // non-destructable OBJ max tile index
#define WHOA    42      // max index destructable OBJ
//SPRITE MACROS###############################
#define WASSER  1       // top.png water alpha puddle
#define FIRE    2       // top.png fireball alpha etherea
#define FALL    3       // top.png alpha waterfall
#define FLUX    4       // top.png flux alpha sparkle
/////////////////////////////////////////////////////////////////////////////////
int pUddles=PUDDLES,pUddlelings=PUDDLES;        // configure weather
int SOLARIS=Solaris;                            // make light
int yakka = WAKKA;      // configure sprite increment
int yekey = WAKKA;      // the greater the WAKKA, GANGHO .base increment increases

	int act_n = 0; // game engine power switch
	int UaI = 0; int UiA = 0;  // on Walk() controls pathfinding loop (?)
    float PALLANTIRx=0,PALLANTIRy=0;    // tracks last mouse click coordinates
    int PALLANTIR=0; // current selected unit
    unsigned char LOCKEY=0; // Blocks interface input


// the incredible script T4c lame recursive parser datastructs
typedef enum { flagsym, ignisym, itemsym, ifsym, elsesym, abrechave, fechachave, abrepar, fechapar, virgula, pontovirgula, aspas, functionsym, number, txt } Simbolo;

char *simbwords[] = { "Flag", "Ignite", "Item", "If", "Else", "{", "}", "(", ")", ",", ";", "\"", "função", "número", "texto" };
char *functionwords[] = { "Digue", "Digue_Window","Give_Mission",               \
                                            "Destroy_Mission",                  \
                    "Give_Party", "Remove_Party",                               \
                    "Create_NPC", "Destroy_NPC", "Kill_NPC",                    \
                    "Give_Item", "Create_Item", "Destroy_Item",                 \
                    "Walk", "Walk_NPC","Walk_NPCS",                             \
                                                    "HasItem",                  \
                                                    "HasSelect",                \
                                                    "HasGold","HasWood",        \
                                                    "HasMission",               \
                                                    "HasParty",                 \
                    "Destroy_Script",                                           \
    "Create_Flag", "Destroy_Flag", "Change_Flag",                               \
    "Change_Obj","Change_Top", "Change_Base","Cinescope","Splash",              \
    "Select", "Play_Music", "Play_Snd",                                         \
    "Give_Xp","Give_Gold", "Give_Hp", "Give_Wood",                              \
                            "mkStruct", "spawnModel", "spawnMarket",            \
                "SetSpiel", "SetLux", "SetRainy","SetYakka", "SetSkinner",      \
        "SetCronos", "SetTanatos", "SetCount", "doCount", "HasCount",           \
                                                        "Lockey", "TeleEGO" };

Simbolo simb;
int radar = 1; int zD = 0;
char func_atual[20];
int n_atual=0, usandoitem=0;
int cartolax=0, cartolay=0, resultCondition=1, linhascript=1, scriptpanic = 0, selected=0, mission[101], rodascript=0, matchCronos=0;
char txt_atual[351];

//////////////////////////////////////////////////////////////////////////////////
// all function prototypes
//
void spawnModel(const char idT[], int alvox, int alvoy);
void Walk(int alvox, int alvoy, double falvox, double falvoy);
void Walk_NPC(int alvox, int alvoy, int nn);
unsigned char Walk_NPCS(int alvox, int alvoy, int x, int y);
int Walk_Party(float falvox, float falvoy, int nn);
int Pega_item(int k, unsigned char n);
void Give_Item(int n, int inix, int iniy);
void HasItem(int x);
void HasParty(int x);
void HasSelect(int x);
void HasGold(int x);
void HasWood(int x);
void Give_Wood(int x);
void Give_Gold(int x);
void Give_Xp(int x);
void Give_Hp(int x);
void Create_Item(int n, int alvox, int alvoy);
void Destroy_Item(int n, int jj);
void Create_NPC(const char idT[], int n, int qty, int nivel, int alvox, int alvoy, int nflag, const char wERK[]);
void Destroy_NPC(int alvox, int alvoy);
void Kill_NPC(int alvox, int alvoy);
void Change_Flag(int x, int alvomapa, int alvox, int alvoy, int mapa_atual);
void Create_Flag(int x, int alvomapa, int alvox, int alvoy, int mapa_atual, const char idT[]);
void Destroy_Flag(int alvomapa, int alvox, int alvoy, int mapa_atual);
void Select_Opt ( int x, char **selectoptions );
void Play_Music(const char musicname[]);
void Play_Snd(const char sndname[]);
void Give_Party(int x, int lvl, int nn);
void Remove_Party(int x);
void makeStruct (const char iDT[], int alvox, int alvoy, char tipo, int x);
/* T4c scripting parser   */
void getsimb_T4c();
int Accept_T4c(Simbolo s);
int Expect_T4c(Simbolo s);
int Compare_T4c(Simbolo s);
void Block_T4c(int prevCondition, int matchcronos, const char idTag[], int indexCartola);
int Act_T4c(const char idTag[], int indexCartola);
/* ********************** */
int Init_SDL (unsigned char act_n);
void Desenha (unsigned char tipo, char sprite, float i, float j, int  WALLA, SDL_Texture *grafic);
void Desenha_terra (unsigned char tipo, char sprite, float i, float j, int  WALLA, SDL_Texture *grafic);
void Desenha_ether (unsigned char tipo, float i, float j, SDL_Texture *grafic);
void Desenha_radar ( int iii, int jjj, int specialK );
void Desenha_Tudo();
void Digue (const char howda[]);
void Digue_Window (const char howda[]);
void Desenha_stats ();
void Input_Teclado ();
int Carrega_Mundo ();
int Grava_Cache_Atual(int n);
int Retoma_Cache(int n, int n_mapa_antigo);
int Novo_Mapa (int act_map, int n_mapa_antigo, int loading);
int SaveGame ();
int LoadGame();
void Move_Criaturas (int kk);
void Move_ether();
void Mochila();
void Caflito (int k, int turno, int i);
void Atualiza_Tudo();
void Act_Tempo ();
void T2gu ();
//////////////////////////////////////////////////////////////////////////////////
//
//
/* BASIC DATA STRUCTURES OF T2gu ENGINE */

struct Tijolos      // map datastruct
{
	unsigned char base;
	unsigned char top;
	unsigned char obj;
	unsigned char cri;
	unsigned char flag;
};


struct Modelone {   // quicky trees and houses prefabs "models.dat" (see: spawnModel("idT",x,y) )
    char idT[300];
    struct Tijolos bricks[9];
};

struct Player   // EGO datastruct, the player
{
    unsigned int tipo;
	int x; int inix;
	int y; int iniy;
	float pxScr;
	float pyScr;
	float xvel;
	float yvel;
	float count_x;
	float count_y;
	unsigned char sprite;
	unsigned char atq;
	unsigned char def;
	int nivel;
	int hp;
	int hpmax;
	unsigned long int xp;
	unsigned char weapon;
	unsigned char armor;
	int gold;
	int wood;
	int water;


};

struct Cartola  // main engine entities datastruct
{
	char id[300];
	unsigned char tipo;
	int x;
	int y;
	float pxScr;
	float pyScr;
	int inix;
	int iniy;
	int hp;
	int hpmax;
	unsigned char nivel;
	unsigned char sprite;
	int flag;
	unsigned char camada;
	unsigned char vivo;
	long int Cronos;
	int Trigger;
	char hostile;
	int caflito;
	char select;
	char werk[300];
};

struct Trupe    // party datastruct
{
	unsigned char tipo;
	int x;
	int y;
	float pxScr;
	float pyScr;
	int hp;
	int hpmax;
	unsigned char xp;
	unsigned char nivel;
	unsigned char sprite;
	unsigned char partykey;
	unsigned char lutando;
	unsigned char walkable;
	unsigned char vivo;
	unsigned char freeze;
	char select;
};

struct Compendio    // NPC attributes, from "data.dat" file
{
	char nome[100];
	int atq;
	int def;
	int hp;
	int dano;
	int xp;
};

struct Timing       // timers
{
	unsigned char tic;
	unsigned char gaia;
	unsigned char mov;
	unsigned char mag;
	unsigned char caflito;
	unsigned char atq;
	unsigned char atqkey;
	unsigned char atqparty[NTRUPY+1];
};

struct Magia        // ETHEREA, water & fireballz matrix
{
	int tipo;
	float pxScr;
	float pyScr;
};

struct Flags        // (?) legacy registers for engine triggers
{
	int valor;
	int x;
	int y;
	int alvox;
	int alvoy;
};

struct Itens        // for inventory bag
{
	char nome[50];
	unsigned char tipo;
	unsigned char valor;
};

struct pathfinder   // pathfinding calculator
{
	unsigned char bloq;
	int list;
	int parx;
	int pary;
	int F;
	int G;
	int H;
	int N;
};

struct pathlista    // pathfinding routes
{
	int x;
	int y;
};

// below, SDL related
// SDL2

int w,h; // rendered text sizes
SDL_Window *window;

SDL_Event Evento;

SDL_Rect src, dest;                         // blit rectangles when drawing
SDL_Renderer *window_renderer;              // hardware accel renderer
SDL_Surface *tela, *graficos[7], *temp, *caixatexto, *texto;    // SDL surfaces
SDL_Texture *texture[7], *cxatxt, *textexto;    // hardware accel tex from surfaces
TTF_Font *font, *bigfont;                       // TTF fonts

Mix_Music *musica;                          // to play music
Mix_Chunk *som;                             // to play sounds

Uint32 *pixmem32;                           // px for radar drawing
SDL_Color  COR, CORv, CORg, CORy;           // some colors


// ENGINE GLOBAL VARIABLES
long int Tempo=0, CRONOS=0;             // main clock, in sec and ms
int TempoGauge=0;                       // player fireball delay counter
int n_item=0;                           // (?)
unsigned int count;                     // living hostile creature counter

struct Tijolos **mapa;                  // MAP. bidimensional[][] struct of terrain layers
struct Magia **ether;                   // ETHEREA, tiles layer of the magic flow
struct Cartola *cartola;                // engine kernel struct of spawned entities

struct Modelone *Modelito;              // pre fab tiles modelz (?) - alpha
struct Itens *item;                     // item attributes

struct Player EGO;                      // player struct
struct Itens *inventory;                // player owned items
struct Trupe party[NTRUPY+1];           // party structs

struct Timing tac;                      // timer ticks
struct Compendio Livro[N_CRI+1];        // NPCs attributes
struct Flags flag[50];                  // legacy flags from .flag files

FILE *arqpt, *scriptpt;                 // file pointers for maps, attributes and scripts

// map engine control
int n_mapa=1;                                                       // current map index
int map_offsets[51];                    // matrix which stores the size of each map
int size_mapa;                          // current active map size in tiles (safe min: 64x64 )
int inix=0, iniy=0, flagX=0, flagY=0;                               // script pos. registers
unsigned char spraite=0, cri_spraite=0, oldsprite=0;                // animation flags
unsigned char movendo=0,meowvendo=0,ataca=0,pegado=0;               // movement flags
int scrx=0, scry=0;                     // per tile scroll offset of screen position
float pxsc=0, pysc=0;                   // per px screen scroll offset
float rx=0, ry=0;                         // radar scroll offset
float DUDEx=0, DUDEy=0;                   // cameraman offset scroll screen position (see: Cinescope function)

// mixed interface switches
int trupyscry = 1;                      // party display scroll on status screen  (pgup/pgdown)
int baggscry = 1;                       // item display scroll on inventory screen  (press i, pgup/pgdown)
unsigned char StatuS=1;                 // toggles (press TAB) status screen
unsigned char usa=20;                   // toggles USE action of this item value set
unsigned char rest=0;                   // toggles party heal/rest condition

// STATUS CONSOLE MESSAGES
char iDito[32][69] = { "", "", "", \
"", "", "", "", "", "", "", "", "", \
"", "", "", "", "", "", "", "", "", \
"", "", "", "", "", "", "", "", "", \
"", "" };                               // start with clean console log
unsigned char iTexto;                   // console lines
