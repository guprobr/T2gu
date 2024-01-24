/* Here be dragonz */

unsigned int mana=0;

#include "T2gu.h"
#include "T2d.c"
#include "T4c.c"


int main (int argc, char *argv[])
{
    T2gu();
}

int Carrega_Mundo ()
{

    printf("\n_ _ _Carrega_Mundo()_ _ _\n");

	FILE *cartolapt;
	char nome_mapa[30];
	int xpos,ypos,i,j, ii, kk=0;

// ITEM and Mochila() structs
	item = malloc(N_ITENS*sizeof(struct Itens));
	if ( item == NULL ) printf ("ERR malloc N_ITENS\n");
	inventory = malloc(NBAG*sizeof(struct Itens));
	if ( inventory == NULL ) printf ("ERR malloc NBAG\n");

	Modelito = malloc(N_MODEL*sizeof(struct Modelone));
	if ( Modelito == NULL ) printf ("ERR malloc N_MODEL\n");

	// CLEAR INVENTORY
	for (ii=0; ii<NBAG; ii++)
	{
		strcpy(inventory[ii].nome, "nada");
		inventory[ii].tipo = 0;
		inventory[ii].valor = 0;
	}



	// Creature attributes
	printf("att> creatures..|");
	if ( (arqpt = fopen("data.dat", "r")) != NULL) {
		for (kk=1; kk<=N_CRI; kk++)
			if ( fscanf(arqpt, "%s\n%d\n%d\n%d\n%d\n%d\n", Livro[kk].nome, &(Livro[kk].atq), &(Livro[kk].def), &(Livro[kk].hp), &(Livro[kk].dano), &(Livro[kk].xp) ) )
			;
			else { printf("ERR 1 data.dat\n"); return 1; }
	// ITEM attributes
		printf("att> itens..|");
		for (kk=1; kk <=N_ITENS; kk++)
			if ( fscanf(arqpt, "%s\n%hhd\n%hhd\n", item[kk].nome, &(item[kk].tipo), &(item[kk].valor) ) )
			;
			else { printf("ERRO 2 data.dat\n"); return 1; }
		fclose(arqpt); printf("read data.dat\n"); } else printf("Cannot read attributes file 'data.dat'\n");

// PREFABS - see: mkModel()
	if ( (cartolapt = fopen("CARTOLA", "wb")) == NULL) { printf ("Err opening ./CARTOLA for writing.\n"); return 1; }

	printf(">>models.dat\n");
	    if ( (arqpt = fopen("models.dat", "rb")) != NULL) {

            for (kk=0; kk<=N_MODEL; kk++) {
                if ( fread( &(Modelito[kk]), sizeof(struct Modelone), 1, arqpt ) );
			}
			fclose(arqpt);
        }
printf("SPAWNING WORLD. .. ..\n");
// LOAD ALL MAPS AND REGISTER THEIR SIZE.
for (ii=1; ii<=50; ii++)
{
	sprintf(nome_mapa, "res/%d.map", ii);
	if ( (arqpt = fopen(nome_mapa, "rb")) == NULL) { printf ("%s: no such file.\n", nome_mapa); return 1; }
        if ( (fread (&size_mapa, sizeof(size_mapa), 1, arqpt)) == 0) { printf("Err: size_mapa\n"); return 1; }
	if ( (fread (&xpos, sizeof(xpos), 1, arqpt)) == 0) { printf("Err: xpos\n"); return 1; }
	if ( (fread (&ypos, sizeof(ypos), 1, arqpt)) == 0) { printf("Err: ypos\n"); return 1; }

// store size of this map [ii]
	map_offsets[ii] = size_mapa;
// HERE ALLOCATION OF THIS MAP [ii]
	mapa = malloc(size_mapa*sizeof(struct Tijolos *));
	if ( mapa == NULL ) { printf("fail to allocate map=%d.\n", ii); return 1; }
	for (i=0; i<=size_mapa-1; i++)
	{
		mapa[i] = malloc(size_mapa*sizeof(struct Tijolos));
		if ( mapa[i] == NULL ) { printf("fail to allocate map=%d.\n", ii); return 1; }
	}
	for (i=0;i<=size_mapa-1;i++)
		if ( (fread (mapa[i], size_mapa*sizeof(struct Tijolos), 1, arqpt)) == 0) { printf("Err reading mapa p inicializar cache\n"); }
	fclose(arqpt);

// HERE ALLOCATION OF ETHEREA, the magical layer

	ether = malloc(size_mapa*sizeof(struct Magia *));
	if ( ether == NULL ) { printf("fail to allocate ether: pointers.\n"); return 1; }
	for (i=0;i<=size_mapa-1;i++)
		ether[i] = malloc(size_mapa*sizeof(struct Magia));
	if ( ether == NULL ) { printf("fail to allocate ether: DATA.\n"); return 1; }


	for(i=0;i<=size_mapa-1;i++)
		for (j=0;j<=size_mapa-1;j++)
		{

                ether[i][j].tipo=0;
                ether[i][j].pxScr=0;
                ether[i][j].pyScr=0;

		}

// HERE ALLOCATION OF T2gu kernel struct Cartola
	cartola = malloc(N_CARTOLA*sizeof(struct Cartola));
	if ( cartola == NULL ) { printf("problem allocating cartola entities\n"); return 1; }

	for (kk=1; kk <= (N_CARTOLA)-1; kk++)
	{
		strcpy(cartola[kk].id, "");
		strcpy(cartola[kk].werk, "");
		cartola[kk].tipo = 0;
		cartola[kk].x = 0;
		cartola[kk].y = 0;
		cartola[kk].pxScr = 0;
		cartola[kk].pyScr = 0;
		cartola[kk].inix = 0;
		cartola[kk].iniy = 0;
		cartola[kk].hp = 0;
		cartola[kk].nivel = 0;
		cartola[kk].sprite = 0;
		cartola[kk].flag = 0;
		cartola[kk].camada = 0;
		cartola[kk].vivo = 0;
		cartola[kk].Cronos = 0;
		cartola[kk].hostile = 0;
		cartola[kk].caflito = 0;
	}
	kk=0;
	for (i=0; i <=size_mapa-1; i++)
		for (j=0; j <=size_mapa-1; j++)
		{
			if (mapa[j][i].cri != 0)
			{
				cartola[kk].tipo = mapa[j][i].cri;
				cartola[kk].x = i;
				cartola[kk].y = j;
				cartola[kk].inix = i;
				cartola[kk].iniy = j;
				cartola[kk].pxScr = (float) i;
				cartola[kk].pyScr = (float) j;
				cartola[kk].flag = mapa[j][i].flag;
				cartola[kk].hpmax = Livro[cartola[kk].tipo].hp;
				cartola[kk].hp = Livro[cartola[kk].tipo].hp;
				cartola[kk].nivel = 1;
				cartola[kk].camada = 3;
				cartola[kk].vivo = 1;
				cartola[kk].hostile = 1;
				cartola[kk].caflito = 1;
				strcpy(cartola[kk].id, Livro[cartola[kk].tipo].nome);
				kk++;
			}
			if (mapa[j][i].flag != 0  )
			{
				cartola[kk].tipo = mapa[j][i].obj;
				cartola[kk].inix = i;
				cartola[kk].iniy = j;
				cartola[kk].pxScr = (float) i;
				cartola[kk].pyScr = (float) j;
				cartola[kk].flag = mapa[j][i].flag;
				cartola[kk].camada = 5;
				kk++;
			}
		}

// Save cache after ignition
	for (i=0;i<=size_mapa-1;i++)
		if ( (fwrite (mapa[i], size_mapa*sizeof(struct Tijolos), 1, cartolapt)) == 0) { printf("Err writing MAPS to initial cache\n"); }
    for (i=0; i<=size_mapa-1; i++)
		free(mapa[i]);
	free(mapa);
	for (i=0;i<=size_mapa-1;i++)
        if ( (fwrite (ether[i], size_mapa*sizeof(struct Magia), 1, cartolapt)) == 0) { printf("Err writing ETHEREA into init ethercache\n"); }
	for (i=0; i<=size_mapa-1; i++)
		free(ether[i]);
	free(ether);
	if ( (fwrite (cartola, N_CARTOLA*sizeof(struct Cartola), 1, cartolapt)) == 0) { printf("Err writing ./CARTOLA struct n=%d\n", ii); return 1; }
	free(cartola);


	printf("....\r");
	printf(".");
}

	fclose(cartolapt);
	printf("\nThus, the world is created.\n");

	return 0;

}

int Grava_Cache_Atual(int n)
{

    printf("\n**>Grava_Cache_Atual(int n=%d)\n", n);

	int i,m=0, k=0;

	if ( (arqpt = fopen("CARTOLA", "r+b")) == NULL) { printf ("cannot write to ./CARTOLA.\n"); return 1; }

	for (i=1; i<=n-1; i++)
		k+=N_CARTOLA;
	for (i=1; i<=n-1; i++)
		m+=map_offsets[i]*map_offsets[i];

	fseek(arqpt, (m*sizeof(struct Tijolos))+(k*sizeof(struct Cartola))+(m*sizeof(struct Magia)), SEEK_SET);
	for (i=0;i<=map_offsets[n]-1;i++)
		if ( (fwrite (mapa[i], size_mapa*sizeof(struct Tijolos), 1, arqpt)) == 0) { printf("Err writing MAP cache\n"); return 1; }
    for (i=0;i<=map_offsets[n]-1;i++)
		if ( (fwrite (ether[i], size_mapa*sizeof(struct Magia), 1, arqpt)) == 0) { printf("Err writing ETHERMAP cache\n"); return 1; }
	//if ( (fwrite (Modelito, N_MODEL*sizeof(struct Modelone), 1, arqpt)) == 0) { printf("Err writing Modelitos de unidades\n"); return 1; }
	if ( (fwrite (cartola, N_CARTOLA*sizeof(struct Cartola), 1, arqpt)) == 0) { printf("Err writing ./CARTOLA cache\n"); return 1; }

	fclose(arqpt);

	return 0;

}

int Retoma_Cache(int n, int n_mapa_antigo)
{

    printf("\n***Retoma_Cache(int n=%d, int n_mapa_antigo=%d)\n", n, n_mapa_antigo);

	int i,m=0, k=0;

	if ( (arqpt = fopen("CARTOLA", "rb")) == NULL) { printf ("\nERROR READ CACHEFILE\nCartola[] kernel cachefile unavailable for reading\n"); return 1; }
	if (n_mapa_antigo != 0) free(cartola);
	if (n_mapa_antigo != 0)
	{ for (i=0;i<=map_offsets[n_mapa_antigo]-1;i++)
		free(mapa[i]);
	free(mapa);
        for (i=0;i<=map_offsets[n_mapa_antigo]-1;i++)
            free(ether[i]);
        free(ether);

	}

	cartola = malloc(N_CARTOLA*sizeof(struct Cartola));
	if ( cartola == NULL ) { printf("problem struct Cartola[] allocation.\n"); return 1; }
	mapa = malloc(map_offsets[n]*sizeof(struct Tijolos *));
	if ( mapa == NULL ) { printf("problem map alloc: pointers\n"); return 1; }
	for (i=0;i<=map_offsets[n]-1;i++)
	{
		mapa[i] = malloc(map_offsets[n]*sizeof(struct Tijolos));
		if ( mapa[i] == NULL ) { printf ("problem map alloc: data\n"); return 1; }
	}
	ether = malloc(map_offsets[n]*sizeof(struct Magia *));
	if ( ether == NULL ) { printf("problem ethermap alloc: pointers\n"); return 1; }
	for (i=0;i<=map_offsets[n]-1;i++)
	{
		ether[i] = malloc(map_offsets[n]*sizeof(struct Magia));
		if ( ether[i] == NULL ) { printf ("problem ethermap alloc: data\n"); return 1; }
	}


	for (i=1; i<=n-1; i++)
		k += N_CARTOLA;
	for (i=1; i<=n-1; i++)
		m+=map_offsets[i]*map_offsets[i];

	fseek(arqpt, (m*sizeof(struct Tijolos))+(k*sizeof(struct Cartola))+(m*sizeof(struct Magia)), SEEK_SET);
	for (i=0;i<=map_offsets[n]-1;i++)
		if ( (fread (mapa[i], map_offsets[n]*sizeof(struct Tijolos), 1, arqpt)) == 0) { printf("ERROR MAP CACHE READ\n"); return 1; }
	for (i=0;i<=map_offsets[n]-1;i++)
		if ( (fread (ether[i], map_offsets[n]*sizeof(struct Magia), 1, arqpt)) == 0) { printf("ERROR MAP ETHERCACHE READ\n"); return 1; }
	//if ( (fread (Modelito, N_MODEL*sizeof(struct Modelone), 1, arqpt)) == 0) { printf("Err reading Modelitos em cache\n"); return 1; }

	if ( (fread (cartola, N_CARTOLA*sizeof(struct Cartola), 1, arqpt)) == 0) { printf("error READ cartola[] CACHE after LOADGAME\n"); return 1; }
	fclose(arqpt);

	return 0;

}

int Novo_Mapa (int act_map, int n_mapa_antigo, int loading)
{

    //QTO=qTO;    // reset zoom

    printf("\nbegin>M A P * C H A N G E %d -> %d \n", n_mapa_antigo, act_map);

	char nome_mapa[30];
	int ii, kk=0,xpos=5,ypos=5;


	count = 0;

// clears mem & WRITE prior ./CARTOLA cache of loaded existing things on engine

        if (n_mapa_antigo != 0 && loading != 1 )
            if (Grava_Cache_Atual(n_mapa_antigo) == 1)
                printf("ERROR REC CACHE\n");


	size_mapa = map_offsets[act_map];
	if ( size_mapa < 64 )
	{ size_mapa = 64;
            map_offsets[act_map] = 64;
                printf("MAP LESS THAN 64x64, forcing fix but no guarantee\n"); }

// legacy: INIT FLAGS, special number vars with correspond to triggers along engine
// flag = 0; //NOTHING
//  flag = 1 to 50; // value corresponds to map index number,
                        // if EGO.x && EGO.y reaches tile with this flag value
                        // triggers an engine map change warp
//  flag 51: creature stop      flag 57: creature stop with script trigger
//  flag 52: (?)                flag 53: (?)
//  flag 54: one-shot script    flag 55: script repeats on tile
//  flag 56: sets map music     flag 58: (?)

	for (ii=0;ii<=49;ii++)
	{
		flag[ii].valor = 0;
		flag[ii].x = 0;
		flag[ii].y = 0;
		flag[ii].alvox = 0;
		flag[ii].alvoy = 0;

	}

	kk=0;
	sprintf(nome_mapa, "res/%d.flag",act_map);
	if ( (arqpt = fopen (nome_mapa, "r")) != NULL) {
		while ( !feof(arqpt)) {
       			if ( fscanf(arqpt, "%d %d", &(flag[kk].x), &(flag[kk].y) ) )
       			 printf(".");
       			else { printf("ERR flag dat\n"); return 1; }
                if ( fscanf(arqpt, "%d %d %d\n", &(flag[kk].valor), &(flag[kk].alvox), &(flag[kk].alvoy) ) )
                 printf(".");
                else { printf("ERR flag dat\n"); return 1; }
                if ( flag[kk].valor <= 50 && n_mapa_antigo == flag[kk].valor )
                {
                        xpos = flag[kk].alvox;
                        ypos = flag[kk].alvoy;
                                                        }
                if ( flag[kk].valor == 56 )
                {
				sprintf(nome_mapa, "snd/music%d.ogg", flag[kk].alvox);

				Play_Music(nome_mapa);

                }
			  kk++;
     		}
	fclose(arqpt); kk=0;} else printf ("Nao pode ler %s\n", nome_mapa);


// READ NEW CARTOLA CACHE

	if (loading != 1) if (Retoma_Cache(act_map, n_mapa_antigo) == 1) printf("ERR reading CARTOLA cache\n");

	printf("map> %d.\n", act_map);

// PLAYER & SCROLL, scroll & PLAYER

    ALOHA = (SCREEN_HEIGHT)/(QTO);

	if (loading != 1)
	{ EGO.x = xpos; EGO.y = ypos; EGO.count_x = EGO.x; EGO.count_y = EGO.y;
	  for (ii=1;ii<=NTRUPY;ii++)
		if (party[ii].tipo != 0 && party[ii].vivo != 0)
		{ party[ii].x = EGO.x -1; party[ii].y = EGO.y -1;
		  party[ii].pxScr = EGO.count_x; party[ii].pyScr = EGO.count_y; }
	}
	/////////////EGO.pxScr = EGO.count_x;
	// sync scrolling vars
	//scrx = (int)pxsc; scry = (int)pysc;
	//rx = scrx; ry = scry;

	EGO.inix = EGO.x; EGO.iniy = EGO.y;

// FLAG CHECK: legacy stuff (?)

	sprintf(nome_mapa, "res/%d.flag",act_map);
	if ( (arqpt = fopen (nome_mapa, "r")) != NULL) {
		while ( !feof(arqpt)) {
       			if ( fscanf(arqpt, "%d %d", &(flag[kk].x), &(flag[kk].y) ) )
       			 printf(".");
       			else { printf("ERRO flagz dat\n"); return 1; }
                if ( fscanf(arqpt, "%d %d %d\n", &(flag[kk].valor), &(flag[kk].alvox), &(flag[kk].alvoy) ) )
                 printf(".");
                else { printf("ERRO flagz dat\n"); return 1; }
			     if ( flag[kk].valor == 54 || flag[kk].valor == 55 )
                    mapa[flag[kk].alvoy][flag[kk].alvox].flag = flag[kk].valor;
			kk++;
     		}
	fclose(arqpt); kk=0;} else printf ("cannot read ler %s -REV\n", nome_mapa);

        // should center cameraman (?)
        DUDEx=pxsc, DUDEy=pysc;

        // deselect all, yeah
        PALLANTIRy = 0; PALLANTIRx = 0;
        PALLANTIR=0;
        for (kk=0;kk<N_CARTOLA;kk++)
            cartola[kk].select = 0;

     printf("entered.map.%d..ETHEREA.(%d)... \n", n_mapa, n_mapa);
        Act_T4c("ETHEREA", -1);

	return 0;


}

int SaveGame ()
{

     printf("SaveGame()\n>rec::");

	FILE *savegamept;
	int i, ii,n_mapa_antigo=0;

	EGO.xvel = 0; EGO.yvel = 0;
	printf("recording cache in savegame\n");

	n_mapa_antigo = n_mapa;
// Save last cache
	if (Grava_Cache_Atual(n_mapa) == 1) printf("ERR WRITING LASTCACHE\n");


// RECORD savegame
	if ( (arqpt = fopen("CARTOLA", "rb")) == NULL) { printf ("problem with ./CARTOLA file\n"); return 1; }
	if ( (savegamept = fopen("savegame", "wb")) == NULL) { printf ("problem with ./savegame file\n"); return 1; }

	if ( (fwrite (&EGO, sizeof(EGO), 1, savegamept)) == 0) { printf("Err writing player EGO in savegame file\n"); return 1; }
	if ( (fwrite (&Lux, sizeof(Lux), 1, savegamept)) == 0) { printf("Err writing LUX in savegame file\n"); return 1; }
	if ( (fwrite (&dayO, sizeof(dayO), 1, savegamept)) == 0) { printf("Err writing DAY in savegame file\n"); return 1; }
	if ( (fwrite (&Tempo, sizeof(Tempo), 1, savegamept)) == 0) { printf("Err writing Tempo in savegame file\n"); return 1; }
	if ( (fwrite (&pUddles, sizeof(pUddles), 1, savegamept)) == 0) { printf("Err writing pUddles in savegame file\n"); return 1; }
	if ( (fwrite (&TempoGauge, sizeof(TempoGauge), 1, savegamept)) == 0) { printf("Err writing TempoGauge in savegame file\n"); return 1; }
	if ( (fwrite (&tac, sizeof(tac), 1, savegamept)) == 0) { printf("Err writing timers tac in savegame file\n"); return 1; }
	if ( (fwrite (inventory, NBAG*sizeof(struct Itens), 1, savegamept)) == 0) { printf("Err writing inventory in savegame file\n"); return 1; }
	if ( (fwrite (&party, sizeof(party), 1, savegamept)) == 0) { printf("Err writing party in savegame file\n"); return 1; }
	if ( (fwrite (&n_mapa, sizeof(int), 1, savegamept)) == 0) { printf("Err writing n_mapa in savegame file\n"); return 1; }
	if ( (fwrite (mission, sizeof(mission), 1, savegamept)) == 0) { printf("Err writing 'mission' in savegame file\n"); return 1; }
	if ( (fwrite (&scrx, sizeof(scrx), 1, savegamept)) == 0) { printf("Err writing 'scrx' in savegame file\n"); return 1; }
	if ( (fwrite (&scry, sizeof(scry), 1, savegamept)) == 0) { printf("Err writing 'scry' in savegame file\n"); return 1; }
	if ( (fwrite (&rx, sizeof(rx), 1, savegamept)) == 0) { printf("Err writing 'rx' in savegame file\n"); return 1; }
	if ( (fwrite (&ry, sizeof(ry), 1, savegamept)) == 0) { printf("Err writing 'ry' in savegame file\n"); return 1; }
	if ( (fwrite (&pxsc, sizeof(pxsc), 1, savegamept)) == 0) { printf("Err writing 'pxsc' in savegame file\n"); return 1; }
	if ( (fwrite (&pysc, sizeof(pysc), 1, savegamept)) == 0) { printf("Err writing 'pysc' in savegame file\n"); return 1; }
	if ( (fwrite (&DUDEx, sizeof(DUDEx), 1, savegamept)) == 0) { printf("Err writing cam'DUDEx' in savegame file\n"); return 1; }
	if ( (fwrite (&DUDEy, sizeof(DUDEy), 1, savegamept)) == 0) { printf("Err writing cam'DUDEy' in savegame file\n"); return 1; }
	if ( (fwrite (&QTO, sizeof(QTO), 1, savegamept)) == 0) { printf("Err writing 'QTO' in savegame file\n"); return 1; }


	// iterate thru all maps
	for (ii=1; ii<=50; ii++)
	{

	// allocate Cartola of [ii] map
		free(cartola);
		cartola = malloc(map_offsets[ii]*map_offsets[ii]*sizeof(struct Cartola));
		if ( cartola == NULL ) { printf("problem allocating units during savegame\n"); return 1; }

    // allocate mapa[][] of [ii] map

		for (i=0; i<=map_offsets[n_mapa_antigo]-1; i++)
			free(mapa[i]);
		free(mapa);

		mapa = malloc(map_offsets[ii]*sizeof(struct Tijolos *));
		if ( mapa == NULL ) { printf ("problem allocating map[] during savegame ..\n"); return 1; }

		for (i=0; i<=map_offsets[ii]-1; i++)
		{
			mapa[i] = malloc(map_offsets[ii]*sizeof(struct Tijolos));
			if ( mapa[i] == NULL ) { printf ("problem allocating map[][] during savegame\n"); return 1; }
		}

    // allocate ETHEREA each spells ether[][] matrix of [ii] map

		for (i=0; i<=map_offsets[n_mapa_antigo]-1; i++)
			free(ether[i]);
		free(ether);

        ether = malloc(map_offsets[ii]*sizeof(struct Magia *));
        if ( ether == NULL ) { printf("failed to allocate ether[]: pointers.\n"); return 1; }

        for (i=0;i<=map_offsets[ii]-1;i++)
        {
            ether[i] = malloc(map_offsets[ii]*sizeof(struct Magia));
            if ( ether == NULL ) { printf("failed to allocate ether[][]: DATA.\n"); return 1; }
        }

// LOAD cache
		for (i=0; i<=map_offsets[ii]-1;i++) // Map
			if ( (fread (mapa[i], map_offsets[ii]*sizeof(struct Tijolos), 1, arqpt)) == 0 && (feof(arqpt)) == 0) { printf("Err reading mapa[][] to save game\n"); return 1; }
		for (i=0; i<=map_offsets[ii]-1;i++) // ETHEREA
			if ( (fread (ether[i], map_offsets[ii]*sizeof(struct Magia), 1, arqpt)) == 0 && (feof(arqpt)) == 0) { printf("Err reading ether[][] to save game\n"); return 1; }
                                        // Cartola
		if ( (fread (cartola, map_offsets[ii]*map_offsets[ii]*sizeof(struct Cartola), 1, arqpt)) == 0 && (feof(arqpt)) == 0) { printf("Err reading entity cache to save game\n"); return 1; }

// RECORD cache in savegame.
		for (i=0; i<=map_offsets[ii]-1;i++) // Map
			if ( (fwrite (mapa[i], map_offsets[ii]*sizeof(struct Tijolos), 1, savegamept)) == 0) { printf("Err writing mapa to save game\n"); return 1; }
		for (i=0; i<=map_offsets[ii]-1;i++) // ETHEREA
			if ( (fwrite (ether[i], map_offsets[ii]*sizeof(struct Magia), 1, savegamept)) == 0) { printf("Err writing ethermapa to save game\n"); return 1; }
                                        // Cartola
		if ( (fwrite (cartola, map_offsets[ii]*map_offsets[ii]*sizeof(struct Cartola), 1, savegamept)) == 0) { printf("Err writing Cartola[] from map=%d in savegame file\n", ii); return 1; }

    // finished recording this map block on savegame

		n_mapa_antigo = ii; // store map last_size for proper deallocation next loop

		printf(":rec.%d.OK", n_mapa_antigo);

	} // itt thru all maps

	printf("\nGame Saved\n");
	fclose(arqpt);
	fclose(savegamept);

// resume last cache
	if (Retoma_Cache(n_mapa, n_mapa_antigo) == 1) printf("Err reading entity cache\n");

        Digue_Window("SAVED GAME");

	return 0;

}

int LoadGame()
{

    printf("LoadGame()\n");

	FILE *savegamept;
	int i, ii,kk=0,n_mapa_antigo=0;

	n_mapa_antigo=n_mapa;
	kk = n_mapa;


	if ( (arqpt = fopen("CARTOLA", "r+b")) == NULL) { printf ("Fail to access ./CARTOLA cachefile.\n"); return 1; }
	if ( (savegamept = fopen("savegame", "rb")) == NULL) { printf ("Fail to open savegame file\n"); return 1; }

	printf("loading game..\n");

	if ( (fread (&EGO, sizeof(EGO), 1, savegamept)) == 0) { printf("Err reading player EGO in savegame file\n"); return 1; }
printf("EGO::");
    if ( (fread (&Lux, sizeof(Lux), 1, savegamept)) == 0) { printf("Err reading LUX in savegame file\n"); return 1; }
    if ( (fread (&dayO, sizeof(dayO), 1, savegamept)) == 0) { printf("Err reading DAY in savegame file\n"); return 1; }
printf("Lux,DAY:::");
	if ( (fread (&Tempo, sizeof(Tempo), 1, savegamept)) == 0) { printf("Err reading Tempo in savegame file\n"); return 1; }
printf("Tempo.:::.");
if ( (fread (&pUddles, sizeof(pUddles), 1, savegamept)) == 0) { printf("Err reading pUddles in savegame file\n"); return 1; }
printf("Clima.::");
	if ( (fread (&TempoGauge, sizeof(TempoGauge), 1, savegamept)) == 0) { printf("Err reading TempoGauge in savegame file\n"); return 1; }
printf("MagicGauge.::");
	if ( (fread (&tac, sizeof(tac), 1, savegamept)) == 0) { printf("Err reading timers tac in savegame file\n"); return 1; }
printf("TickTacz....");
	if ( (fread (inventory, NBAG*sizeof(struct Itens), 1, savegamept)) == 0) { printf("Err reading inventory in savegame file\n"); return 1; }
printf("inventory....");
	if ( (fread (&party, sizeof(party), 1, savegamept)) == 0) { printf("Err reading party in savegame file\n"); return 1; }
printf("PARTY[].....\n");
	if ( (fread (&n_mapa, sizeof(int), 1, savegamept)) == 0) { printf("Err reading n_mapa in savegame file\n"); return 1; }
printf("\nwill resume from map::%d...", n_mapa);
printf("-map_loaded.-\n");
printf("journal..");
	if ( (fread (mission, sizeof(mission), 1, savegamept)) == 0) { printf("Err reading 'mission' in savegame file\n"); return 1; }
	if ( (fread (&scrx, sizeof(scrx), 1, savegamept)) == 0) { printf("Err reading 'scrx' in savegame file\n"); return 1; }
	if ( (fread (&scry, sizeof(scry), 1, savegamept)) == 0) { printf("Err reading 'scry' in savegame file\n"); return 1; }
	if ( (fread (&rx, sizeof(rx), 1, savegamept)) == 0) { printf("Err reading 'rx' in savegame file\n"); return 1; }
	if ( (fread (&ry, sizeof(ry), 1, savegamept)) == 0) { printf("Err reading 'ry' in savegame file\n"); return 1; }
	if ( (fread (&pxsc, sizeof(pxsc), 1, savegamept)) == 0) { printf("Err reading 'pxsc' in savegame file\n"); return 1; }
	if ( (fread (&pysc, sizeof(pysc), 1, savegamept)) == 0) { printf("Err reading 'pysc' in savegame file\n"); return 1; }
    if ( (fread (&DUDEx, sizeof(DUDEx), 1, savegamept)) == 0) { printf("Err reading cam'DUDEx' in savegame file\n"); return 1; }
	if ( (fread (&DUDEy, sizeof(DUDEy), 1, savegamept)) == 0) { printf("Err reading cam'DUDEy' in savegame file\n"); return 1; }
	if ( (fread (&QTO, sizeof(QTO), 1, savegamept)) == 0) { printf("Err reading 'QTO' ZOOM in savegame file\n"); return 1; }

	printf("!OK!..LOADING WORLD:::");

	// itt thru every map
	for (ii=1; ii<=50; ii++)
	{

	// allocate Cartola of [ii] map
		free(cartola);
		cartola = malloc(map_offsets[ii]*map_offsets[ii]*sizeof(struct Cartola));
		if ( cartola == NULL ) { printf("problem allocating units.\n"); return 1; }

    // allocate mapa[][] of [ii] map

		for (i=0; i<=map_offsets[kk]-1; i++)
			free(mapa[i]);
		free(mapa);

		mapa = malloc(map_offsets[ii]*sizeof(struct Tijolos *));
		if ( mapa == NULL ) { printf ("problem allocating map to load game\n"); return 1; }
		for (i=0; i<=map_offsets[ii]-1; i++)
		{
			mapa[i] = malloc(map_offsets[ii]*sizeof(struct Tijolos));
			if ( mapa[i] == NULL ) { printf ("problem allocating map to load game\n"); return 1; }
		}

	// allocate ETHEREA each spell ether[][] matrix of [ii] map

		for (i=0; i<=map_offsets[kk]-1; i++)
			free(ether[i]);
		free(ether);

        ether = malloc(size_mapa*sizeof(struct Magia *));
        if ( ether == NULL ) { printf("problem allocating ether[]: pointers.\n"); return 1; }
        for (i=0;i<=size_mapa-1;i++)
        {
            ether[i] = malloc(size_mapa*sizeof(struct Magia));
            if ( ether == NULL ) { printf("problem allocating ether[][]: DATA.\n"); return 1; }
        }

// Load cache from savegame [ savegamept ->  ]
		for (i=0;i<=map_offsets[ii]-1;i++) // MAP
			if ( (fread (mapa[i], map_offsets[ii]*sizeof(struct Tijolos), 1, savegamept)) == 0 && (feof(savegamept)) == 0) { printf("Err reading map from savegamel\n"); return 1; }
        for (i=0;i<=map_offsets[ii]-1;i++) // ETHEREA
			if ( (fread (ether[i], map_offsets[ii]*sizeof(struct Magia), 1, savegamept)) == 0 && (feof(savegamept)) == 0) { printf("Err reading ethermap from savegame\n"); return 1; }
                                        // Cartola
		if ( (fread (cartola, map_offsets[ii]*map_offsets[ii]*sizeof(struct Cartola), 1, savegamept)) == 0 && (feof(savegamept)) == 0) { printf("Err reading ./CARTOLA cache from savegame\n"); return 1; }

// SAVE cache from savegame  [ ./CARTOLA file arqpt <- ]
		for (i=0;i<=map_offsets[ii]-1;i++)  // MAP
			if ( (fwrite (mapa[i], map_offsets[ii]*sizeof(struct Tijolos), 1, arqpt)) == 0 && (feof(savegamept)) == 0) { printf("Err writing map cache while loadgame\n"); return 1; }
		for (i=0;i<=map_offsets[ii]-1;i++)  // ETHEREA
			if ( (fwrite (ether[i], map_offsets[ii]*sizeof(struct Magia), 1, arqpt)) == 0 && (feof(savegamept)) == 0) { printf("Err writing ethercache while resuming loadgame\n"); return 1; }
                                        // Cartola
		if ( (fwrite (cartola, map_offsets[ii]*map_offsets[ii]*sizeof(struct Cartola), 1, arqpt)) == 0) { printf("Err writing cache while resuming loadgame\n"); return 1; }

		kk = ii; // store map last_size for proper deallocation next loop
		printf("->%d::OK,", n_mapa_antigo);

	} // itt thru every ii map

	fclose(savegamept);
	fclose(arqpt);

// resume last cache
	if (Retoma_Cache(n_mapa, kk) == 1) printf("Err reading entity cache\n");

	printf("\n\n***GAME LOADED. from map::%d to map::%d\n", n_mapa_antigo, n_mapa);

	Novo_Mapa(n_mapa, n_mapa_antigo, 1 );

	return 0;

}

void Move_Criaturas (int kk)
{
    int i,j;

	float cocozal, *pcocozal;
	pcocozal = &cocozal;

	if (cartola[kk].vivo == 1 && cartola[kk].camada == 3 && cartola[kk].x >= 0)
	{

            	// randomize direction and move creature, if there is no flag that sets creature to remain still
		if ( cartola[kk].flag != 51 && cartola[kk].flag != 57 && cartola[kk].Cronos == 0 )
            if ( cartola[kk].y-1 >= 0 && cartola[kk].y+1 < size_mapa && cartola[kk].x-1 >= 0 && cartola[kk].x+1 < size_mapa)
			switch ( (rand() % 25) )
			{
                // MOVE RIGHT
					case 1:
					case 2:
					if (mapa[cartola[kk].y][cartola[kk].x+1].obj == 0 && cartola[kk].x+1 != EGO.x && cartola[kk].y != EGO.y )  cartola[kk].pxScr += STEP/5;
					cartola[kk].sprite = 4+cri_spraite*(rand()%2);
					break;
                // MOVE LEFT
                    case 3:
                    case 4:
					if (mapa[cartola[kk].y][cartola[kk].x-1].obj == 0 && cartola[kk].x-1 != EGO.x && cartola[kk].y != EGO.y )  cartola[kk].pxScr -= STEP/5;
					cartola[kk].sprite = 2+cri_spraite*(rand()%2);
					break;
                // MOVE DOWN
                    case 5:
                    case 6:
					if (mapa[cartola[kk].y+1][cartola[kk].x].obj == 0 && cartola[kk].x != EGO.x && cartola[kk].y+1 != EGO.y )  cartola[kk].pyScr += STEP/5;
					cartola[kk].sprite = 0+cri_spraite*(rand()%2);
					break;
                // MOVE UP
                    case 7:
                    case 8:
					if (mapa[cartola[kk].y-1][cartola[kk].x].obj == 0 && cartola[kk].x != EGO.x && cartola[kk].y-1 != EGO.y ) cartola[kk].pyScr -= STEP/5;
					cartola[kk].sprite = 6+cri_spraite*(rand()%2);
					break;
                // NO-OP  // creature remain still
                    case 9:
                    case 10:
                    break;
                // /* HOSTILE MAY CAST FIREBALL
                    case 11:
                    case 12:
                    case 13:
                    case 14:
                    case 15:

                        if ( cartola[kk].hostile && !(rand()%16) ) // hostile creatures can cast fireball,
                        {
                            ether[cartola[kk].y][cartola[kk].x].tipo = 21-(rand()%5);
                            ether[cartola[kk].y][cartola[kk].x].pxScr = cartola[kk].pxScr;
                            ether[cartola[kk].y][cartola[kk].x].pyScr = cartola[kk].pyScr;
                        }

                    break; // */

                // ADVANCE TOWARDS OBJECTIVE
                // hostile wants to reach player, not hostile wants to reach prize tiles,
                                                // when negative flag is set to their index
                                                // example: Create_NPC("peasant",20,3,1,-6,-1,-9,"woodchucker")
                                                // spawns with id "peasant" unit index=20,
                                                //  three units of level 1, about 5 tiles near player, prize tile=9
                                                //  when reach a tile index=9 it will run "woodchucker" block of T4c script
                    case 16:
                    default:

                    if( cartola[kk].hostile ) {

									if ( cartola[kk].pxScr > EGO.count_x)
										if (mapa[cartola[kk].y][cartola[kk].x-1].obj == 0 && cartola[kk].pxScr-STEP != EGO.count_x && cartola[kk].pyScr != EGO.count_y ) { cartola[kk].pxScr -= STEP*2; cartola[kk].sprite = 2+spraite*(rand()%2); }
									if ( cartola[kk].pxScr < EGO.count_x)
										if (mapa[cartola[kk].y][cartola[kk].x+1].obj == 0 && cartola[kk].pxScr+STEP != EGO.count_x && cartola[kk].pyScr != EGO.count_y ) { cartola[kk].pxScr += STEP*2; cartola[kk].sprite = 4+spraite*(rand()%2); }
									if ( cartola[kk].pyScr > EGO.count_y)
										if (mapa[cartola[kk].y-1][cartola[kk].x].obj == 0 && cartola[kk].pxScr != EGO.count_x && cartola[kk].pyScr-STEP != EGO.count_y ) { cartola[kk].pyScr -= STEP*2; cartola[kk].sprite = 6+spraite*(rand()%2); }
									if ( cartola[kk].pyScr < EGO.count_y)
										if (mapa[cartola[kk].y+1][cartola[kk].x].obj == 0 && cartola[kk].pxScr != EGO.count_x && cartola[kk].pyScr+STEP != EGO.count_y ) { cartola[kk].pyScr += STEP*2; cartola[kk].sprite = 0+spraite*(rand()%2); }

                            }
                            else if(cartola[kk].flag < -1 && cartola[kk].Cronos == 0 )
            // ELSE, if not hostile and proper flag is set,
			// go for prize tile direction

                                    for (i=-9;i<9 ;i++)
                                        for (j=-9;j<9 ;j++)
                                            if ( i+cartola[kk].y >= 1 && i+cartola[kk].y < size_mapa-1 && j+cartola[kk].x >= 1 && j+cartola[kk].x < size_mapa-1)
                                                if (mapa[cartola[kk].y+i][cartola[kk].x+j].obj == abs(cartola[kk].flag) )
                                                {
                                                    if ( j > 0 ) {
                                                            cartola[kk].pxScr += STEP*2;
                                                            break;
                                                        }
                                                    else if ( j < 0 ) {
                                                            cartola[kk].pxScr -= STEP*2;
                                                            break;
                                                        }
                                                    if ( i > 0 ) {
                                                            cartola[kk].pyScr += STEP*2;
                                                            break;
                                                       }
                                                    else if ( i < 0 ) {
                                                            cartola[kk].pyScr -= STEP*2;
                                                            break;
                                                        }

                                                }


                        break; // case 25

        } // movement switch

	} // cartola.vivo block


	// LIMIT MOVEMENT FOR SAFETY (?)
		if(cartola[kk].pxScr >= size_mapa-2) cartola[kk].pxScr = size_mapa-2;
		if(cartola[kk].pyScr >= size_mapa-2) cartola[kk].pyScr = size_mapa-2;
		if(cartola[kk].pxScr <= 1) cartola[kk].pxScr = 1;
		if(cartola[kk].pyScr <= 1) cartola[kk].pyScr = 1;

		if (modff(cartola[kk].pxScr, pcocozal) >= 0.55)
			cartola[kk].x = (int)ceilf(cartola[kk].pxScr);
		else cartola[kk].x = (int)floorf(cartola[kk].pxScr);
		if (modff(cartola[kk].pyScr, pcocozal) >= 0.55)
			cartola[kk].y = (int)ceilf(cartola[kk].pyScr);
		else cartola[kk].y = (int)floorf(cartola[kk].pyScr);


}


void Move_ether()
{
	int i, j;
	for (i=5;i<=size_mapa-6;i++)
		for (j=5;j<=size_mapa-6; j++)
			//if ( i >= 2 && j >= 2 && i <= size_mapa-3 && j <= size_mapa-3)
            {
// // limiter to avoid segfaults

    if ( ether[i][j].pxScr < 2 || ether[i][j].pxScr > size_mapa-3  )
            ether[i][j].tipo = 0;
    if ( ether[i][j].pyScr < 2 || ether[i][j].pyScr > size_mapa-3  )
            ether[i][j].tipo = 0;

            //destructable OBJ with fireball
				if ( ( mapa[i][j].obj > WHEE && mapa[i][j].obj < WHOA )  && \
					 								 ether[i][j].tipo > 0 )
				{ mapa[i][j].obj = 0; ether[i][j].tipo = 11;
                        Desenha(FLUX, 0, j-pxsc, i-pysc, WAKKA*5, texture[1]);
                    }
				if ( (ether[i][j].tipo > 0) && (ether[i][j].tipo <= 10) ) // player fireballz
				{
					if ( (EGO.sprite == 0) || (EGO.sprite == 1) || (EGO.sprite == 8) )
					{ if (i+5 <= size_mapa-3)
						{ ether[i+1][j].tipo = ether[i][j].tipo-1; ether[i+1][j].pxScr = ether[i][j].pxScr; ether[i+1][j].pyScr = ether[i][j].pyScr; ether[i+1][j].pyScr++; }
						ether[i][j].tipo -= 1;
						 }
					if ( (EGO.sprite == 2) || (EGO.sprite == 3) || (EGO.sprite == 8) )
					{ if (j-5 >= 3)
						{ ether[i][j-1].tipo = ether[i][j].tipo-1; ether[i][j-1].pxScr = ether[i][j].pxScr; ether[i][j-1].pyScr = ether[i][j].pyScr; ether[i][j-1].pxScr--; }
						ether[i][j].tipo -= 1;
						 }
					if ( (EGO.sprite == 4) || (EGO.sprite == 5) || (EGO.sprite == 8) )
					{ if (j+5 <= size_mapa-3)
						{ ether[i][j+1].tipo = ether[i][j].tipo-1; ether[i][j+1].pxScr = ether[i][j].pxScr; ether[i][j+1].pyScr = ether[i][j].pyScr; ether[i][j+1].pxScr++; }
						ether[i][j].tipo -= 1;
						 }
					if ( (EGO.sprite == 6) || (EGO.sprite == 7) || (EGO.sprite == 8) )
					{ if (i-5 >= 3)
						{ ether[i-1][j].tipo = ether[i][j].tipo-1; ether[i-1][j].pxScr = ether[i][j].pxScr; ether[i-1][j].pyScr = ether[i][j].pyScr; ether[i-1][j].pyScr--; }
						ether[i][j].tipo -= 1;
						 }
                    //return;
                  }
				if ( (ether[i][j].tipo > 11) && (ether[i][j].tipo <= 21) ) // creature fireballz
				{

					if ( (EGO.x > j) && (EGO.y > i) && j+5 <= size_mapa-3 && i+5 <= size_mapa-3 )
					{ ether[i+1][j+1].tipo = ether[i][j].tipo-1; ether[i+1][j+1].pxScr = ether[i][j].pxScr; ether[i+1][j+1].pyScr = ether[i][j].pyScr; ether[i+1][j+1].pyScr++; ether[i+1][j+1].pxScr++; ether[i][j].tipo = 0; }
					if ( (EGO.x < j) && (EGO.y < i) && j-5 >= 3 && i-5 >= 3 )
					{ ether[i-1][j-1].tipo = ether[i][j].tipo-1; ether[i-1][j-1].pxScr = ether[i][j].pxScr; ether[i-1][j-1].pyScr = ether[i][j].pyScr; ether[i-1][j-1].pyScr--; ether[i-1][j-1].pxScr--; ether[i][j].tipo = 0;  }
					if ( (EGO.x < j) && (EGO.y > i) && j-5 >- 3 && i+5 <= size_mapa-3 )
					{ ether[i+1][j-1].tipo = ether[i][j].tipo-1; ether[i+1][j-1].pxScr = ether[i][j].pxScr; ether[i+1][j-1].pyScr = ether[i][j].pyScr; ether[i+1][j-1].pyScr++; ether[i+1][j-1].pxScr--; ether[i][j].tipo = 0;  }
					if ( (EGO.x > j) && (EGO.y < i) && j+5 <= size_mapa-3 && i-5 >= 3 )
					{ ether[i-1][j+1].tipo = ether[i][j].tipo-1; ether[i-1][j+1].pxScr = ether[i][j].pxScr; ether[i-1][j+1].pyScr = ether[i][j].pyScr; ether[i-1][j+1].pyScr--; ether[i-1][j+1].pxScr++; ether[i][j].tipo = 0;  }
					if ( (EGO.x == j) && (EGO.y > i) && i+5 <= size_mapa-3 )
					{ ether[i+1][j].tipo = ether[i][j].tipo-1; ether[i+1][j].pxScr = ether[i][j].pxScr;  ether[i+1][j].pyScr = ether[i][j].pyScr; ether[i+1][j].pyScr++; ether[i][j].tipo = 0;  }
					if ( (EGO.x == j) && (EGO.y < i) && i-5 >= 3 )
					{ ether[i-1][j].tipo = ether[i][j].tipo-1; ether[i-1][j].pxScr = ether[i][j].pxScr;  ether[i-1][j].pyScr = ether[i][j].pyScr; ether[i-1][j].pyScr--;  ether[i][j].tipo = 0; }
					if ( (EGO.x > j) && (EGO.y == i) && j+5 <= size_mapa-3  )
					{ ether[i][j+1].tipo = ether[i][j].tipo-1; ether[i][j+1].pxScr = ether[i][j].pxScr; ether[i][j+1].pyScr = ether[i][j].pyScr; ether[i][j+1].pxScr++;  ether[i][j].tipo = 0;  }
					if ( (EGO.x < j) && (EGO.y == i) && j-5 >= 3  )
					{ ether[i][j-1].tipo = ether[i][j].tipo-1; ether[i][j-1].pxScr = ether[i][j].pxScr; ether[i][j-1].pyScr = ether[i][j].pyScr; ether[i][j-1].pxScr--; ether[i][j].tipo = 0;  }
					//return;
				} /* else { // (?)¿?????

                    switch ( ether[i][j].tipo/10 ) {

                        case 2:
                            if ( ether[i][j].tipo/10 == (ether[i][j].tipo-1)/10 )
                            {
                                ether[i+1][j].tipo = ether[i][j].tipo-1;
                                ether[i+1][j].pxScr = ether[i][j].pxScr;
                                ether[i+1][j].pyScr = ether[i][j].pyScr+1;
                            }
                        break;
                        case 3:
                            if ( ether[i][j].tipo/10 == (ether[i][j].tipo-1)/10 )
                            {
                                ether[i][j-1].tipo = ether[i][j].tipo-1;
                                ether[i][j-1].pxScr = ether[i][j].pxScr-1;
                                ether[i][j-1].pyScr = ether[i][j].pyScr;
                            }
                        break;
                        case 4:
                            if ( ether[i][j].tipo/10 == (ether[i][j].tipo-1)/10 )
                            {
                                ether[i][j+1].tipo = ether[i][j].tipo-1;
                                ether[i][j+1].pxScr = ether[i][j].pxScr+1;
                                ether[i][j+1].pyScr = ether[i][j].pyScr;
                            }
                        break;
                        case 5:
                            if ( ether[i][j].tipo/10 == (ether[i][j].tipo-1)/10 )
                            {
                                ether[i-1][j].tipo = ether[i][j].tipo-1;
                                ether[i-1][j].pxScr = ether[i][j].pxScr;
                                ether[i-1][j].pyScr = ether[i][j].pyScr-1;
                            }
                        break;

                    }

				} // Other magicz -- soon */
				 /////if  ( ether[i][j].tipo == 11 )
                      ////      ether[i][j].tipo = -111; // (?)
     // make wasser on low terrain
    if ( mapa[i][j].base == 2 && !mapa[i][j].top )
                ether[i][j].tipo=-1*(1+((i%pUddlelings)*(j%pUddlelings)));

        }


}


void Mochila()
{
	int cursorX=0; int cursorY=0, i, k, lido=0;

	int w=0;
	char msg[255];


	while (lido != 1)
	{

		src.x = 0; src.y =0; dest.x = 220; dest.y = 150;
		src.w = 135; dest.w = 135; src.h = 120; dest.h = 120;

		SDL_RenderCopy(window_renderer, cxatxt, &src, &dest);


		src.x = 5; src.y =0; dest.x = 355; dest.y = 150;
		src.w = 135; dest.w = 135; src.h = 120; dest.h = 120;

		SDL_RenderCopy(window_renderer, cxatxt, &src, &dest);


        sprintf(msg, "%d", baggscry);
        texto = TTF_RenderUTF8_Solid (bigfont, msg, CORv);
				dest.y=150;
				dest.x=480;

    textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

                TTF_SizeText(bigfont, msg, &w, &h);
                    dest.w = w;
                    dest.h = h;
				SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


				SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
				texto = NULL;
                                // party stats yey
		for(w=(5*baggscry)-5; w<=4+(baggscry*5); w++)
			if (inventory[w].tipo)
			{
				src.x = (inventory[w].tipo-60)*50; src.y =0;
				dest.x = 222+(w%5)*50; dest.y = (50*(w/(5*baggscry)))+160;

				src.w = 50; dest.w = 50; src.h = 50; dest.h = 50;

                SDL_RenderCopy(window_renderer, texture[5], &src, &dest);

			}

		if (cursorX > 4)
            cursorX = 4;
        if (cursorX < 1)
            cursorX = 0;
        if (cursorY > 1)
            cursorY = 1;
        if (cursorY < 1)
            cursorY = 0;

		k=cursorX+(5*cursorY)+(5*baggscry)-5;

		src.x = 0; src.y =0; dest.x = 222+cursorX*50; dest.y = 152+(cursorY%5)*50;
		src.w = 50; dest.w = 50; src.h = 50; dest.h = 50;

		SDL_RenderCopy(window_renderer, texture[5], &src, &dest);



		texto=TTF_RenderUTF8_Solid(bigfont, inventory[k].nome, CORv);
		dest.x = 225;
		dest.y = 255;

			textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

     TTF_SizeText(bigfont, inventory[k].nome, &w, &h);
        dest.w = w;
        dest.h = h;
    SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


		SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
		texto = NULL;

            SDL_RenderPresent(window_renderer);


		SDL_WaitEvent(&Evento);

		if (Evento.type == SDL_KEYDOWN)
			switch (Evento.key.keysym.sym)
			{
				case SDLK_RETURN:   // close bag
				case SDLK_ESCAPE:
					lido = 1;
					break;
				case SDLK_LEFT:
					cursorX--;
					break;
				case SDLK_RIGHT:
					cursorX++;
					break;
				case SDLK_UP:
					cursorY--;
					break;
				case SDLK_DOWN:
					cursorY++;
					break;
				case SDLK_SPACE:    // USE selected item
					if (inventory[k].tipo != 0) usa = k;
					lido = 1;
					break;
				case SDLK_d:    // DROP selected item
					if (inventory[k].tipo != 0)
					{

							for (i=1;i<=(N_CARTOLA)-1;i++)
								if (cartola[i].camada == 0)
								{

                                    cartola[i].tipo = inventory[k].tipo;
									cartola[i].inix = 1+EGO.x+(1+(rand()%2)*(-1*(rand()%2)));
                                    cartola[i].iniy = 1+EGO.y+(1+(rand()%2)*(-1*(rand()%2)));
                                    cartola[i].x = cartola[i].inix;
                                    cartola[i].y = cartola[i].iniy;
                                    cartola[i].pxScr = (float)(cartola[i].inix);
                                    cartola[i].pyScr = (float)(cartola[i].iniy);
                                    //mapa[cartola[i].y][cartola[i].x].flag = inventory[k].tipo ;
                                    // mapa[cartola[i].y][cartola[i].x].obj = 0;

                                  strcpy(cartola[i].id, item[inventory[k].tipo-60].nome);
                                    cartola[i].hpmax = 1; //Livro[inventory[k].tipo].hp;
                                    cartola[i].hp = cartola[i].hpmax;
                                    cartola[i].flag = inventory[k].tipo;
                                    cartola[i].vivo = 0;
                                    cartola[i].sprite = 0;
									cartola[i].camada = 1;

                                    sprintf(msg, "Largou %s", inventory[k].nome);
									Digue(msg);

									inventory[k].tipo = 0; strcpy(inventory[k].nome, "nada"); inventory[k].valor = 0;


									break;




                                }

					}
					lido = 1;
					break;
                // SCROLL bag
					case SDLK_PAGEUP:
                            baggscry--;
                            if (baggscry < 1 ) baggscry = 1;
                        break;
                        case SDLK_PAGEDOWN:
                            baggscry++;
                            if ( baggscry > (NBAG/10)*2) baggscry = (NBAG/10)*2;
                        break;
                ///////////////////

			}
        // CURSOR cycle thru bag
		if (Evento.type == SDL_KEYUP)
			switch(Evento.key.keysym.sym)
			{
				case SDLK_LEFT:
					if (EGO.xvel != STEP) EGO.xvel = 0.0;
					break;
				case SDLK_RIGHT:
					if (EGO.xvel != -STEP) EGO.xvel = 0.0;
					break;
				case SDLK_UP:
					if (EGO.yvel != STEP) EGO.yvel = 0.0;
					break;
				case SDLK_DOWN:
					if (EGO.yvel != -STEP) EGO.yvel = 0.0;
					break;
			}

	} // while lido!-1

}

void Caflito (int k, int turno, int i)
{

	char msg[255];
	int dado=1, dano=1;

	// creature vs PLAYER
	if ( turno && cartola[k].caflito ) {

        // red square
	 Desenha (0, 0, cartola[k].x-(pxsc), cartola[k].y-(pysc), 0, texture[5]);


	sprintf(msg, "%s attacks!", Livro[cartola[k].tipo].nome); Digue(msg );
	cartola[k].pxScr += (((1+(rand()%2))*-1)+(rand()%2))*STEP;


	cartola[k].sprite = 8;
	dado = ((rand()%6)+1);
	if ( (dado + Livro[cartola[k].tipo].atq+cartola[k].nivel >= EGO.def + EGO.armor) || (dado == 6) )
	{
		Digue("Hit.");
		dano = -((rand()%Livro[cartola[k].tipo].dano)+1+cartola[k].nivel);
		EGO.hp += dano;
		Play_Snd("snd/ATK.wav");

		sprintf(msg, "%d", dano);

		texto=TTF_RenderUTF8_Solid(bigfont, msg, CORv);

			textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

		dest.x = QTO*(EGO.x-scrx);
		dest.y = QTO*(EGO.y-pysc);

        TTF_SizeText(bigfont, msg, &w, &h);
        dest.w = w;
        dest.h = h;
		SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


		SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
		texto = NULL;

		// PHEE-r00laz
		SDL_SetTextureAlphaMod(texture[2], 200);
		SDL_SetTextureColorMod(texture[2], 255,128,128);
            Desenha(FLUX,0,(STEP*(rand()%3))+EGO.x-pxsc,EGO.y-pysc, yakka*4, texture[1]);
        ////////////////
	} else { Digue ("miss..."); }

        cartola[k].caflito = 0; // delay next atk
    }
	// player turn
	if ( turno && ataca && tac.atq )
	{
		sprintf(msg, "You ATK %s", Livro[cartola[k].tipo].nome); Digue(msg);
            Desenha (183, spraite, STEP+EGO.x-(pxsc), STEP+EGO.y-(pysc), yakka*3, texture[2]);

		dado = ((rand()%6)+1);
		if ( (dado + EGO.atq + EGO.weapon >= Livro[cartola[k].tipo].def ) || (dado == 6) )
		{
			dano = ((rand()%3)+1)*EGO.nivel;
			sprintf(msg, "hit! %d damage %s", dano, Livro[cartola[k].tipo].nome); Digue(msg);
			cartola[k].hp -= dano;
			Play_Snd("snd/ATK.wav");
			//if ( cartola[k].hp <= 0 ) cartola[k].vivo = 0;

			sprintf(msg, "%d", -dano);

		texto=TTF_RenderUTF8_Solid(font, msg, CORg);

			textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

		dest.x = QTO*(cartola[k].x-scrx);
		dest.y = QTO*(cartola[k].y-pysc);

        TTF_SizeText(bigfont, msg, &w, &h);
        dest.w = w;
        dest.h = h;
		SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


		SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
		texto = NULL;

        // PHEE-r00laz
        SDL_SetTextureAlphaMod(texture[2], 200);
		SDL_SetTextureColorMod(texture[2], 128,255,128);
            Desenha(FLUX,0,(STEP*(rand()%3))+cartola[k].x-pxsc,cartola[k].y-pysc, yakka*3, texture[1]);
        ////////////////


		} else { Digue ("miss..."); Play_Snd("snd/erratq.wav");  }

            ataca = 0; tac.atq = 0;

	}

	// party VS creature
	if (!turno && !party[i].lutando )
	{
		sprintf(msg, "%s ATK %s", Livro[party[i].tipo].nome, Livro[cartola[k].tipo].nome); Digue(msg);
             Desenha (183, spraite, STEP+party[i].x-(pxsc), STEP+party[i].y-(pysc), yakka*3, texture[2]);

		//party[i].pxScr += (((1+(rand()%2))*-1)+(rand()%2))*STEP;

		party[i].sprite = 8;
		dado = ((rand()%6)+1);
		if ( (dado + Livro[party[i].tipo].atq+(party[i].nivel) >= Livro[cartola[k].tipo].def+cartola[k].nivel ) || (dado == 6) )
		{
			dano = ((rand()%Livro[party[i].tipo].dano)+1+party[i].nivel);
			sprintf(msg, "Hit! dmg: %d", dano); Digue(msg);
			cartola[k].hp -= dano;
			//if ( cartola[k].hp <= 0 ) cartola[k].vivo = 0;
        sprintf(msg, "%d", -dano);

		texto=TTF_RenderUTF8_Solid(font, msg, CORg);

			textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

		dest.x = QTO*(cartola[k].x-scrx);
		dest.y = QTO*(cartola[k].y-pysc);

         TTF_SizeText(bigfont, msg, &w, &h);
        dest.w = w;
        dest.h = h;
		SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


		SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
		texto = NULL;

			Play_Snd("snd/ATK.wav");

			// PHEE-r00laz
			SDL_SetTextureAlphaMod(texture[2], 200);
            SDL_SetTextureColorMod(texture[2], 128,128,255);
                Desenha(FLUX,0,(STEP*(rand()%3))+cartola[k].x-pxsc,cartola[k].y-pysc, yakka*3, texture[1]);
			////////////////
				} else Digue ("miss..." );

                party[i].lutando = 1;
                party[i].partykey = 0;


	}
	  // creature vs PARTY
    if ( !turno && cartola[k].caflito ) {

    // red square
	 Desenha (0, 0, cartola[k].x-(pxsc), cartola[k].y-(pysc), 0, texture[5]);
	sprintf(msg, "%s ATK %s!", Livro[cartola[k].tipo].nome, Livro[party[i].tipo].nome ); Digue(msg );
	//cartola[k].pxScr += (((1+(rand()%2))*-1)+(rand()%2))*STEP;

	cartola[k].sprite = 8;
	dado = ((rand()%6)+1);
	if ( (dado + Livro[cartola[k].tipo].atq+(cartola[k].nivel) >= Livro[party[i].tipo].def+party[i].nivel ) || (dado == 6) )
	{
		Digue("H I T");
		dano = dado+((rand()%Livro[cartola[k].tipo].dano)+1+cartola[k].nivel);
		party[i].hp -= dano;

		// PHEE-r00laz
		SDL_SetTextureAlphaMod(texture[2], 200);
            SDL_SetTextureColorMod(texture[2], 255,128,128);
                Desenha(FLUX,0,(STEP*(rand()%3))+party[i].x-pxsc,party[i].y-pysc, yakka*3, texture[1]);
        ////////////////

		sprintf(msg, "%d", -dano);

		texto=TTF_RenderUTF8_Solid(font, msg, CORv);

			textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

		dest.x = QTO*(party[i].x-scrx);
		dest.y = QTO*(party[i].y-pysc);

         TTF_SizeText(bigfont, msg, &w, &h);
        dest.w = w;
        dest.h = h;
		SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


		SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
		texto = NULL;

	} else { Digue ("miss...");  }

            cartola[k].caflito = 0;
        }

}


void Atualiza_Tudo()
{

	long int k,i,j,a,b,x,y,n_mapa_ant;
	char msg[500];

	int xptmp,cartolavivo=0; //, okmov=1;
	float ii,jj, cocozal, *pcocozal;

	pcocozal = &cocozal;

// the layer below: DRAW mapa[][].obj layer and TOP below-layer

	for (j=-5; j< ALOHA; j++)
		for (i=-5; i< ALOHA*1.5; i++)
            if (i+scrx<=size_mapa-1 && j+scry<=size_mapa-1 \
			 && i+scrx >= 0 && j+scry >= 0 )
                if ( mapa[j+scry][i+scrx].obj || mapa[j+scry][i+scrx].top ) {
                   Desenha (mapa[j+scry][i+scrx].obj, 0, i-(pxsc-scrx), j-(pysc-scry), yakka*2, texture[2]);
                    if ( ether[j+scry][i+scrx].tipo < 0 )
                        Desenha_ether(FALL, i-(pxsc-scrx), j-(pysc-scry), texture[1] ); // waterfall :D
                    if ( mapa[j+scry][i+scrx].top <= 128 && mapa[j+scry][i+scrx].top )
                        Desenha (mapa[j+scry][i+scrx].top, 0, i-(pxsc-scrx), j-(pysc-scry), yakka*2, texture[1]);
                }

// TEST if player levelled up
	if (EGO.xp >= 50)
	{ EGO.nivel++; EGO.hpmax += 5; EGO.hp = EGO.hpmax; EGO.atq++; EGO.def++;
		xptmp = EGO.xp-50; EGO.xp = 0; EGO.xp += xptmp; TempoGauge = 0; tac.mag=1;
		Digue ("YOU LEVELLED UP!"); Play_Snd("snd/bling.wav"); }

// TEST if using an item
	usandoitem = 0;
	if (usa != 20)	{sprintf(msg, "Usando %s", inventory[usa].nome);Digue(msg);
		usandoitem = inventory[usa].tipo+60;
		Act_T4c(inventory[usa].nome, -1);
    }

mana = 0; // living entities counter on T2gu cartola[]
	// **************************************************************************************
	// Let's do the "for k"
	K=0;
	for (k=1; k<=((N_CARTOLA-1)); k++)
        if ( cartola[k].tipo || cartola[k].flag )
        {   K++;

        ///////////////////////////////////
/////// first, will DRAW  this creature if onscreen

if ( cartola[k].camada != 1 ) { // if not item
    // check boundaries first
	if ( cartola[k].pxScr-pxsc < ALOHA*1.5 && \
        cartola[k].pxScr-pxsc >= 0 && cartola[k].pyScr-pysc >= 0 && \
            cartola[k].pyScr-pysc < ALOHA )
        //// DRAW CREATURE AND STATUS BAR
            {

                Desenha (cartola[k].tipo, cartola[k].sprite+(cri_spraite*cartola[k].vivo), cartola[k].pxScr-(pxsc), cartola[k].pyScr-(pysc), yakka, texture[3]);
                // creature HP bar
                    if ( !StatuS )
						for (int ixe=0; ixe<=((float)(cartola[k].hp)/(float)(cartola[k].hpmax))*25; ixe++ )
                            {
                                src.x = 0; src.y=100; src.w=3; src.h = 3;
                                dest.x = QTO*(cartola[k].pxScr-pxsc); dest.y=ixe+QTO*(cartola[k].pyScr-pysc);
                                dest.w = src.w; dest.h = src.h;
                                    SDL_SetTextureColorMod(texture[6],100+(cartola[k].hp/(cartola[k].hpmax)+1)*100,0,100);
                                    SDL_RenderCopy(window_renderer, texture[6], &src, &dest);
                                    SDL_SetTextureColorMod(texture[6],255,255,255);
                            }
                if ( cartola[k].select ) // if this is selected, draw selector circle
                    Desenha (0, 0, cartola[k].pxScr-(pxsc), cartola[k].pyScr-(pysc), yakka, texture[5]);

            }
} //// else, its an item, just draw it if onscreen;
else if ( cartola[k].x-pxsc < ALOHA*1.5 && \
        cartola[k].x-pxsc >= 0 && cartola[k].y-pysc >= 0 && \
            cartola[k].y-pysc < ALOHA ) {

            Desenha (cartola[k].flag-60, 0, cartola[k].x-(pxsc), cartola[k].y-(pysc), yakka, texture[5]);
            if ( cartola[k].select ) // if this is selected, draw selector circle
                Desenha (0, 0, cartola[k].pxScr-(pxsc), cartola[k].pyScr-(pysc), yakka, texture[5]);

        }
///////////////////////////////////// ok, creature drew
////////////////////////////////////////////////////////////////

// CHANGE MAP?
        // TEST collision which mapchange flag (1-50)
                    if ( (cartola[k].flag >= 1 && cartola[k].flag <= 50 \
            && EGO.x == cartola[k].inix && EGO.y == cartola[k].iniy) && !movendo )
			{ n_mapa_ant = n_mapa; n_mapa = cartola[k].flag; pegado = 1; Novo_Mapa(n_mapa, n_mapa_ant, 0);
                return; }

// had success SELECT ENTITY,
    // if LEFT clicked entity region on screen ?
    if ( PALLANTIRx )
        if ( cartola[k].tipo && cartola[k].pxScr+0.5 >= (PALLANTIRx) && cartola[k].pyScr+0.5 >=  (PALLANTIRy) && \
                              cartola[k].pxScr-0.5 <= (PALLANTIRx) && cartola[k].pyScr-0.5 <=  (PALLANTIRy) )
        {
            // since click hit entity, de-select previous and select it
                    PALLANTIRy = 0; PALLANTIRx = 0;
                     if ( PALLANTIR > 0 )
                        cartola[PALLANTIR].select = 0;
                      if ( PALLANTIR < 0 )
                        party[abs(PALLANTIR)].select = 0;

                PALLANTIR = k; // store index of selected entity
                               cartola[k].select = 1;

                if ((cartola[k].x+1) >= EGO.x && (cartola[k].y+1) >= EGO.y \
                    && (cartola[k].x-1) <= EGO.x && (cartola[k].y-1) <= EGO.y )
                        ataca = 1;  // force SPACEBAR (ATK/ACTivate) on entity

        }

// check if ATK/ACT and script trigger area
if (  ataca )
            // if reaches non-hostile NPC
	if ( !cartola[k].hostile && cartola[k].pxScr+1 >= EGO.count_x && cartola[k].pyScr+1 >= EGO.count_y \
        && cartola[k].pxScr-1 <= EGO.count_x && cartola[k].pyScr-1 <= EGO.count_y )
    // and NPC has flag 57 set, success..
       if ( cartola[k].flag == 57 )
		 { ataca=0; cartolax = cartola[k].x; cartolay = cartola[k].y;
                            // EXECUTE T4C SCRIPT WITH CORRESPONDING IDt
												Act_T4c(cartola[k].id, k);
                                            pegado = 1;
                                            rodascript = 0; }
        //// executed Ignite(cartola[k].id) { } block on T4c script

// REST if asked so ( press r while far from hostile creature )

		if ( rest == 1 && !movendo )
		{
			b=0;
			for (a=1;a<=NTRUPY;a++)
				if (party[a].tipo != 0)
					if ( (party[a].hp < party[a].hpmax || EGO.hp < EGO.hpmax) )
					{
						b++;
						for (i=-2; i <= 2; i++)
							for (j=-2; j <= 2; j++)
								if ( cartola[k].y == party[a].y+i && cartola[k].x == party[a].x+j && cartola[k].vivo == 1 && cartola[k].hostile)
								{ rest = 0; Digue ("Nao pode descansar."); return;}
					}

			i=0;
			for (a=1;a<=NTRUPY;a++)
				if (party[a].tipo != 0)
					i++;

			if ( i == 0 ) b = 1;
			if ( b != 0 )
			{
				EGO.xvel = 0; EGO.yvel = 0;
				Digue ("Descansando...");
				for (i=-4; i <= 4; i++)
					for (j=-4; j <= 4; j++)
						if ( cartola[k].y == EGO.y+i && cartola[k].x == EGO.x+j && cartola[k].vivo == 1 && cartola[k].hostile)
						{ rest = 0; Digue ("Nao pode descansar."); return;}


				if (tac.caflito)  { if ( EGO.hp < EGO.hpmax ) EGO.hp += 1;
					for (a=1;a<=NTRUPY;a++)
						if (party[a].tipo != 0 && party[a].hp < party[a].hpmax)
							party[a].hp+=1;
					Digue ("Descansado 1hp."); rest = 0;}

			} else rest = 0;

		} // END REST loop

if ( cartola[k].vivo ) {

// non-hostile NPC special verifications
if ( !cartola[k].hostile ) {
    if ( !cartola[k].Cronos ) { // no active timer set
////// woodchucker
//////////// test if negative flag set
////////////    transform obj if close to it in +5 value
//////////////  RUNS t4c script block corresponding to iDT;
        if (cartola[k].flag < -1  ) {
            for (i=-1;i<=1;i++)
                for (j=-1;j<=1;j++)
                    if ( mapa[cartola[k].y+i][cartola[k].x+j].obj == abs(cartola[k].flag )  ) // atingiu madeira
                    {
                        sprintf(msg, "%s found %s (%d)", Livro[cartola[k].tipo].nome, cartola[k].werk, cartola[k].flag);
                            Digue(msg);
                            mapa[cartola[k].y+i][cartola[k].x+j].obj += 5;
                            printf(". %s.. \n",cartola[k].id);
                            cartola[k].Cronos = CRONOS;
                    }
        }
    } else {    // else, if CRONOS is set
// checks individual timer
   if ( cartola[k].Cronos >0  ) {
	if ( ( CRONOS > cartola[k].Cronos ) ) // if timer elapsed, RUN t4c script
        {
                printf(". %s.. \n",cartola[k].id);
                    cartola[k].Cronos = 0;
                    Act_T4c(cartola[k].id, k);
        }
    } else { // else CRONOS set but value is negative,
            // this is a delayer timer, unset CRONOS when elapsed

            if ( CRONOS > abs(cartola[k].Cronos ) && cartola[k].flag < -1  )
                cartola[k].Cronos = 0;

            }
    }
} // END if !not hostile checks

// IS NPC STILL ALIVE?
//// GRIM REAPER, everything not VIVO or hp <= 0 (DIES) vivo = 0;
        if ( cartola[k].hp <= 0  )
		{

                    cartola[k].hp=-1;
            // will die
			Play_Snd("snd/SPLATY.wav");
			if ( cartola[k].hostile )
                cartola[k].sprite = -10;
            else cartola[k].sprite = 10;

			////////////////////////////// check for SetTanatos
			if ( cartola[k].hostile == 2 ) {
                                printf(". %s.. \n",cartola[k].id);
                        Act_T4c(cartola[k].id, k);
                }
			 //////////////////// SetTanatos RUNS t4c script when creature dies

			 if ( cartola[k].hostile ) {
                    int  precious=(rand()%21)+cartola[k].nivel*10;
                    cartola[k].hostile = 0;
                        Give_Gold(precious);
                        sprintf(msg, "got %d gold", precious);
                        Digue(msg);
                } // killed hostile, show me the money

			cartola[k].vivo = 0; // actually kills creature
                            EGO.xp+=Livro[cartola[k].tipo].xp/EGO.nivel;
                            EGO.xp++;

			////cartola[k].flag = 82; // RESSURRECTABILITY's
			 for (i=1;i<=NTRUPY;i++)
				if (party[i].tipo)
                {	 party[i].xp+=Livro[cartola[k].tipo].xp/party[i].nivel;
                     party[i].xp+=rand()%3;
                                            }

            }


// Move this creature
		if ( tac.mov ) { if ( rand()%2 )
                            Move_Criaturas(k); }


// HOSTILE CREATURE CHECKS
if ( cartola[k].hostile  ) {
// test if hit by fireball
		if (  (ether[cartola[k].y][cartola[k].x].tipo <= 10) && (ether[cartola[k].y][cartola[k].x].tipo > 0 ) )
		{ ether[cartola[k].y][cartola[k].x].tipo = 0; ether[cartola[k].y][cartola[k].x].pxScr=0; ether[cartola[k].y][cartola[k].x].pyScr=0;
            if (ether[cartola[k].y][cartola[k].x].tipo == 10)
                cartola[k].hp -= EGO.nivel*2;
            else cartola[k].hp -= EGO.nivel;

                Desenha(FLUX, 0, cartola[k].x-pxsc, cartola[k].y-pysc, WAKKA*3, texture[1]);

                        Play_Snd("snd/SPLATY.wav");

            if (ether[cartola[k].y][cartola[k].x].tipo == 10)
                sprintf(msg, "%d", -EGO.nivel*2);
            else sprintf(msg, "%d", -EGO.nivel);

            texto=TTF_RenderUTF8_Solid(font, msg, CORg);

            	textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

                dest.x = QTO*(cartola[k].x-scrx);
                dest.y = QTO*(cartola[k].y-pysc);

                 TTF_SizeText(bigfont, msg, &w, &h);
                dest.w = w;
                dest.h = h;
                SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


                SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
                texto = NULL;
            }
    // hostilizazier
            if ( (rand()%3) )
                if ( tac.caflito )
                    cartola[k].caflito = 1;

// party[i] verification against creature
    for (i=1;i<=NTRUPY;i++)
        if (party[i].tipo  )
        // just if creature is near party member..
            if ((cartola[k].x+2) >= party[i].x && (cartola[k].y+2) >= party[i].y \
					&& (cartola[k].x-2) <= party[i].x && (cartola[k].y-2) <= party[i].y)
                  if (!mapa[cartola[k].y][cartola[k].x].obj ) // check valid tile
                    {
                            if ( party[i].partykey && !party[i].lutando )
                              { Walk_Party ( cartola[k].pxScr, cartola[k].pyScr, i );
                                party[i].partykey = 0; } // move against creature
                                    // if close, fight
                            if (cartola[k].pxScr <= party[i].pxScr+1     \
                                && cartola[k].pxScr >= party[i].pxScr-1  \
                                && cartola[k].pyScr <= party[i].pyScr+1  \
                                && cartola[k].pyScr >= party[i].pyScr-1  )
                                    Caflito(k, 0, i);

// NOTE:
// THIS SUX performance the bigger N_TRUPE (max party member units)
            } // END party[i] checks against cartola[k] ..


// if ATK/ACT pressed while player near creature, combat
// if creature reaches player, combat

               if ((cartola[k].x+1) >= EGO.x && (cartola[k].y+1) >= EGO.y \
                    && (cartola[k].x-1) <= EGO.x && (cartola[k].y-1) <= EGO.y )
                    if ( tac.mov && ( cartola[k].caflito || ataca ) )
                        Caflito(k, 1, 0);

        cartolavivo = 1;    // set to proper living creature counter msg

    } // hostile?


} // cartola[k].vivo?


// ITEM COLLISION CHECKS
    if ( cartola[k].camada == 1 )
         if ( cartola[k].flag >= 60 && cartola[k].flag <= 60+N_ITENS )
            for (ii=-1;ii<=1;ii+=0.25)
				for(jj=-1;jj<=1;jj+=0.25)
					if ( cartola[k].x-(EGO.x+ii) == 0 && cartola[k].y-(EGO.y+jj)==0 )
                        if ( !pegado ) {
                                    Pega_item(k, cartola[k].tipo);
                                    cartola[k].select = 0;
                                    if ( PALLANTIR == k )
                                        PALLANTIR = 0;
                                }
		if ( cartola[k].vivo && cartola[k].hostile )
            mana++; // upd hostile creature counter

   } // END OF cartola[k] loop
///////////////////////////////////////////////

// verify if killed all hostile on map

    if (cartolavivo == 0 && count == 0)
		{ Digue_Window("YOU KILLED ALL HOSTILES!"); count = 1;	}


// party upd
	for (i=1;i<=NTRUPY;i++)
		if ( party[i].tipo )
		{

			// formation
			switch (EGO.sprite)
			{
				case 0:
				a=(i%2); b=(i/2);
				break;
				case 2:
				a=-2-(i%4); b=-(i%2);
				break;
				case 4:
				a=2+(i%4); b=(i%2);
				break;
				case 6:
				a=(i%5); b=2+(i%5);
				break;
				default:
				a=0; b=1;
				break;

			}

            if ( party[i].select ) // if member is selected, draw circle around it
                    Desenha (0, 0, party[i].pxScr-(pxsc), party[i].pyScr-(pysc), yakka, texture[5]);

        // test if clicked LEFT button above party member
        if ( party[i].x == floor(PALLANTIRx) && party[i].y ==  floor(PALLANTIRy)  )
                  { // clicked above party member, de-select previous entity
                    // and...
                    // select it!

                    party[i].select = 1;

                    PALLANTIRy = 0; PALLANTIRx = 0;
                     if ( PALLANTIR > 0 )
                        cartola[PALLANTIR].select = 0;
                    if ( PALLANTIR < 0 )
                        party[abs(PALLANTIR)].select = 0;

                    PALLANTIR = -1*i;

                }

// PARTY MOVEMENT
if ( party[i].partykey && !party[i].select && !party[i].lutando ) {
 if ((int)(EGO.count_y+b) > 1 && (int)(EGO.count_y+b) < size_mapa-2 \
    && (int)(EGO.count_x+a) > 1 && (int)(EGO.count_x+a) < size_mapa-2)
    {
      if ( !mapa[(int)(EGO.count_y+b)][(int)(EGO.count_x+a)].obj )
        {  Walk_Party ((int)(EGO.count_x+a), (int)(EGO.count_y+b), i);
           party[i].partykey = 0;
        } else {
                Walk_Party (party[i].x, party[i].y, i);
                party[i].partykey = 0;
            }
    }
} // party movement


// test if spell hits party
if ( (ether[party[i].y][party[i].x].tipo > 9) && (ether[party[i].y][party[i].x].tipo <= 255) )
    {
        ether[party[i].y][party[i].x].tipo = 0;
        ether[party[i].y][party[i].x].pxScr=0; ether[party[i].y][party[i].x].pyScr=0;
        party[i].hp -= 1; Digue("FIREBALL hits party member!"); Play_Snd("snd/magiatq.wav");
                                                                                            }

				// test if member is alive
				if ( party[i].hp <= 0)
				{

                        party[i].hp=-1;

					for (a=1; a<=(N_CARTOLA)-1;a++)
						if (cartola[a].camada == 0)
						{
							cartola[a].tipo = party[i].tipo;
							cartola[a].pxScr = party[i].pxScr;
							cartola[a].pyScr = party[i].pyScr;
							cartola[a].x = party[i].x;
							cartola[a].y = party[i].y;
							cartola[a].inix = party[i].x;
							cartola[a].iniy = party[i].y;
							cartola[a].nivel = party[i].nivel;
							cartola[a].sprite = 10;
							cartola[a].camada = 3;
							cartola[a].flag = 82;
							cartola[a].vivo = 0;
							break;
						}
					sprintf(msg, "%s is now dead.", Livro[party[i].tipo].nome); Digue(msg);
					party[i].vivo = 0; party[i].tipo = 0; party[i].sprite = 10;
					// re-arrange positions
					for (j=1;j<=NTRUPY;j++)
						if (party[j].tipo == 0)
							for (a=1;a<=NTRUPY;a++)
								if (a > j && party[a].tipo != 0)
								{
									party[j].tipo=party[a].tipo;
									party[j].x = party[a].x;
									party[j].y = party[a].y;
									party[j].pxScr = party[a].pxScr;
									party[j].pyScr = party[a].pyScr;
									party[j].hp = party[a].hp;
									party[j].hpmax = party[a].hpmax;
									party[j].nivel = party[a].nivel;
									party[j].xp = party[a].xp;
									party[j].sprite = party[a].sprite;
									party[j].vivo = party[a].vivo;
									party[j].partykey = party[a].partykey;
									party[j].lutando = party[a].lutando;
									party[j].walkable = party[a].walkable;
									party[j].select = party[a].select;
									party[a].tipo=0;
									party[a].x = 0;
									party[a].y = 0;
									party[a].pxScr = 0;
									party[a].pyScr = 0;
									party[a].hp = 0;
									party[a].hpmax = 0;
									party[a].xp = 0;
									party[a].nivel = 0;
									party[a].sprite = 0;
									party[a].vivo = 0;
									party[a].partykey = 0;
									party[a].lutando = 0;
									party[a].walkable = 0;
									party[a].select = 0;
									break;
								}
				}
				// tests party member level up
				if (party[i].xp >= 50)
				{
					party[i].nivel++; party[i].hpmax += 5; party[i].hp = party[i].hpmax;
					xptmp = party[i].xp-50; party[i].xp = 0; party[i].xp+=xptmp;
					sprintf(msg, "%s passou de nível!", Livro[party[i].tipo].nome); Digue(msg);
					Play_Snd("snd/bling.wav");
				}

///////// DRAW EACH PARTY MEMBER VISIBLE ON SCREEN

			if ( party[i].pyScr-pysc >= 0 && party[i].pxScr-pxsc >= 0 \
			&& party[i].pyScr-pysc < ALOHA  \
			 && party[i].pxScr-pxsc < ALOHA*1.5  )
					{
						Desenha (party[i].tipo, party[i].sprite+(spraite), party[i].pxScr-pxsc,  party[i].pyScr-pysc, yakka, texture[3]);

                // hp bar of party
                    if ( !StatuS )
						for (int ixe=0; ixe<=((float)(party[i].hp)/(float)(party[i].hpmax))*25; ixe++ ) {
                            src.x = 0; src.y=100; src.w=3; src.h = 3;
                                dest.x = QTO*(party[i].pxScr-pxsc); dest.y=ixe+QTO*(party[i].pyScr-pysc);

                                    dest.w = src.w; dest.h = src.h;
                                    SDL_SetTextureColorMod(texture[6],0,255,0);
                                SDL_RenderCopy(window_renderer, texture[6], &src, &dest);
                                    SDL_SetTextureColorMod(texture[6],255,255,255);

                            }

					}

    } //// [i] party upd


//////////////////// De-Selector 3000 plus:::
// since click did not hit any entity, de-select de-select de-select
            if ( PALLANTIRx ) {
                    PALLANTIRy = 0; PALLANTIRx = 0;
                     if ( PALLANTIR > 0 )
                        cartola[PALLANTIR].select = 0;
                      if ( PALLANTIR < 0 )
                        party[abs(PALLANTIR)].select = 0;
                    PALLANTIR = 0;
                }

////////// DRAW PLAYER
	Desenha(EGO.tipo,EGO.sprite+(spraite),EGO.count_x-pxsc,EGO.count_y-pysc, yakka, texture[3]);


// DRAW -UPPER- TOP layer
	for (j=0; j< ALOHA; j++)
		for (i=0; i< ALOHA*1.5; i++)
			if (i+scrx<=size_mapa-1 && j+scry<=size_mapa-1  \
			 && i+scrx >= 0 && j+scry >= 0 )
                if ( mapa[j+scry][i+scrx].top > 128 )
					Desenha (mapa[j+scry][i+scrx].top, 0, i-(pxsc-scrx), j-(pysc-scry), yakka, texture[1]);

if ( radar ) {

// radar background box
    SDL_SetTextureColorMod(cxatxt, \
			0, \
             0, \
              0);
            src.x = 0;
            src.y = 0;
            src.w = 1;
            src.h = 1;
            dest.x = SCREEN_WIDTH-(SCREEN_WIDTH/4)+25;
            dest.y = SCREEN_HEIGHT-(SCREEN_HEIGHT/2)-55;
            dest.w = 150;
            dest.h = 150;

        SDL_SetTextureAlphaMod(cxatxt, -1);
        SDL_RenderCopy(window_renderer, cxatxt, &src, &dest);

// NPC radar
for (k=1; k<=((N_CARTOLA-1)); k++)
        if ( cartola[k].vivo && (cartola[k].tipo || cartola[k].flag) )
        	if ( (cartola[k].pxScr < EGO.x+50 && cartola[k].pxScr > EGO.x-50) \
                        && (cartola[k].pyScr < EGO.y+50 && cartola[k].pyScr > EGO.y-50) )
							Desenha_radar(cartola[k].x, cartola[k].y, k );

// PARTY radar
	for (i=1;i<=NTRUPY;i++)
		if ( party[i].tipo )
		{

				src.x = 8;
                src.y = 8;
                src.w = 3;
                src.h = 3;
                dest.x = SCREEN_WIDTH-(SCREEN_WIDTH/6)+((party[i].x)-rx);
                dest.y = SCREEN_HEIGHT-(SCREEN_HEIGHT/2)+((party[i].y)-ry);
                dest.w = 3;
                dest.h = 3;
                SDL_RenderCopy(window_renderer, texture[6], &src, &dest);

        }

//PLAYER radar

            src.x = 15;
            src.y = 0;

        src.w = 3;
        src.h = 3;

                dest.x = SCREEN_WIDTH-(SCREEN_WIDTH/6)+((EGO.x)-rx);
                dest.y = SCREEN_HEIGHT-(SCREEN_HEIGHT/2)+((EGO.y)-ry);

      dest.w = 5;
      dest.h = 5;

        SDL_RenderCopy(window_renderer, texture[6], &src, &dest);

    }

// dude cameraman

if ( DUDEx != pxsc ) {
    if ( DUDEx > pxsc ) {
        pxsc+=STEP; //DUDEx-=STEP*3;
         if ( DUDEx < pxsc )
           { pxsc = DUDEx; }
        } else { pxsc-=STEP; //DUDEx+=STEP*3;
              if ( DUDEx > pxsc )
                  { pxsc = DUDEx; }
                }
    }

if ( DUDEy != pysc ) {
    if ( DUDEy > pysc ) {
        pysc+=STEP; //DUDEy-=STEP*2;
          if ( DUDEy < pysc )
            { pysc = DUDEy; }
        } else { pysc-=STEP; //DUDEy+=STEP*2;
                 if ( DUDEy > pysc )
                   { pysc = DUDEy; }
                }
    }


// reset "using item" flag
	usa = 20; // this mechanism will soon change! :PPP


// test if spell hits player
    if ( (ether[EGO.y][EGO.x].tipo > 10) && (ether[EGO.y][EGO.x].tipo <= 21) )
		{   ether[EGO.y][EGO.x].tipo = 0;
            ether[EGO.y][EGO.x].pxScr=0; ether[EGO.y][EGO.x].pyScr=0;
                            EGO.hp -= 3;
                            Digue("You got hit by a fireball!");

                        Desenha(FLUX, 0, EGO.x-pxsc, EGO.y-pysc, WAKKA*6, texture[1]);
                        Play_Snd("snd/magiatq.wav");
        }

// MOVE player,

 if (modff(EGO.count_x+EGO.xvel, pcocozal) >= 0.84)
		x = (int)ceilf(EGO.count_x+EGO.xvel);
	else x = (int)floorf(EGO.count_x+EGO.xvel);
	if (modff(EGO.count_y+EGO.yvel, pcocozal) >= 0.20)
		y = (int)ceilf(EGO.count_y+EGO.yvel);
	else y = (int)floorf(EGO.count_y+EGO.yvel);

	 if ( !( x < 2 || x > size_mapa-1 ) )
	     if ( mapa[y][x].obj == 0 || movendo )
            { EGO.pxScr += EGO.xvel; EGO.count_x += EGO.xvel;
                pegado = 0;
             } // move on x axis mapa[][Xxx]
    if ( !( y < 2 || y > size_mapa-1 ) )
        if ( mapa[y][x].obj == 0 || movendo )
            { EGO.pyScr += EGO.yvel; EGO.count_y += EGO.yvel;
                pegado = 0;
            } // move on y axis mapa[Yyy][]


// protect segmentation
if ( EGO.x > size_mapa-1 )
    EGO.x = size_mapa-1;
if ( EGO.x < 1 )
    EGO.x = 1;
if ( EGO.y > size_mapa-1 )
    EGO.y = size_mapa-1;
if ( EGO.y < 1 )
    EGO.y = 1;

// SCREEN SCROLL STUFF

        if ( EGO.pxScr > 8.0 ) {EGO.pxScr -= STEP; pxsc+=STEP; DUDEx+=STEP; rx+=STEP; }
        if ( EGO.pxScr < 8.0 ) {EGO.pxScr += STEP; pxsc-=STEP; DUDEx-=STEP; rx-=STEP; }
        if ( EGO.pyScr > 8.0 ) {EGO.pyScr -= STEP; pysc+=STEP; DUDEy+=STEP; ry+=STEP; }
        if ( EGO.pyScr < 8.0 ) {EGO.pyScr += STEP; pysc-=STEP; DUDEy-=STEP; ry-=STEP; }
        if ( EGO.pxScr > 9.0 && pxsc == size_mapa-1) EGO.pxScr = 9.0;
        if ( EGO.pyScr > 9.0 && pysc == size_mapa-1) EGO.pyScr = 9.0;
        if ( EGO.pxScr < 1.0 && pxsc == 0) EGO.pxScr = 1.0;
        if ( EGO.pyScr < 1.0 && pysc == 0) EGO.pyScr = 1.0;

// protect memory segmentation
if ( pxsc > size_mapa-1)
    pxsc=size_mapa-1;
if ( pxsc < 0)
    pxsc=0;
if ( pysc > size_mapa-1)
    pysc=size_mapa-1;
if ( pysc < 0)
    pysc=0;

    // per tile scrolling sync with per px scrolling
	scrx = (int)pxsc; scry = (int)pysc;

// proper tile index rounding from float to int
////////////////////////////////// (?)
if (modff(EGO.count_x, pcocozal) >= 0.75)
		EGO.x = (int)ceilf(EGO.count_x);
	else EGO.x = (int)floorf(EGO.count_x);
	if (modff(EGO.count_y, pcocozal) >= 0.75)
		EGO.y = (int)ceilf(EGO.count_y);
	else EGO.y = (int)floorf(EGO.count_y);
	///////////////////////////////// */

// set tick to zero, delay loop in TICKZ ms
   tac.tic = 0;
        tac.mov = 0;
        tac.caflito = 0;   // see Act_Tempo()

        // Move magic and render water, the ETHEREA ether[][] matrix
        Move_ether();

} // ******************************** END Atualiza_Tudo



void Act_Tempo ()
{
	static long int temptac=0, temptoc=0, tempmov=0, tempcaflito=0, tempatq=0, tempotimer=0;
	static char SandMan;
	int i,k=0;


///////////////////////////////////////////////////////// TICKZ controls
///////////////////////////////////////////////////////// main loop
	if ( SDL_GetTicks() >= temptac + TICKZ )
	{	temptac = SDL_GetTicks();


        tac.tic = 1;

			if ( EGO.nivel < 245 ) { // too high value of EGO.nivel
                            // put as divisor,
                            // could cause float point exception
                if (tac.mag == 0) {
                    TempoGauge++;
                    if (TempoGauge >= 10/EGO.nivel)
                        tac.mag = 1;
                }

            } else  // über level does not need mana timer
                tac.mag = 1;

    }


	if (SDL_GetTicks() >= tempotimer + 1000 )   // TEMPO is independent of TICKz
	{ // this is the main clock

                                // TEMPO is actual seconds, like a clock
                    tempotimer = SDL_GetTicks();
                                    Tempo++;
                                    CRONOS = (Tempo*1000);

                        // also make pUddlelings (¿)
                        // lame rain effect
                            if ( rainy ) {
                                    pUddlelings = pUddles+(2*(-1*(rand()%2))+1);
                                if ( pUddlelings > pUddles+4 || pUddlelings < pUddles-4 )
                                    pUddlelings = pUddles;
                                }

            pegado=0; // action trigger flag

                                        }/////////////// END OF CLOCK TIMER

///////////////// below These control entities stuff - - animation & combat
    if ( SDL_GetTicks() >= temptoc + TICKZ*3 ) // reset ATK mode (SPACEBAR)
	{	temptoc = SDL_GetTicks();
            // turn party
                    for (i=1;i<=NTRUPY;i++)
                            if ( party[i].tipo != 0 ) {
                                if ( rand()%3 )
                                    party[i].partykey = 1; // also party turn
                            } else break;

	ataca=0;    }
///////////////////////////////////////  PLAYER atk trigger delay timer
	if ( SDL_GetTicks() >= tempatq + 4*TICKZ )
	{	tempatq = SDL_GetTicks(); tac.atq=1;
	// main animation sprite
                    spraite = (rand()%2); }
//////////////////////////////// CREATURE MOVEMENT
	if ( SDL_GetTicks() >= tempmov + TICKZ*5 ) // tac.mov controls NPC turn
	{	tempmov = SDL_GetTicks();

            tac.mov = 1;


                // also toggle creature sprite
                    cri_spraite = (rand()%2);



      } //tac.mov timer


	if ( SDL_GetTicks() >= tempcaflito + (TICKZ*TICKZ) ) // world spin
	{

	tempcaflito = SDL_GetTicks();

    // main combat trigger, delay timer
        tac.caflito = 1; // also party atk delay timer
                                        // between atks
                    if ( (rand()%3) ) {
                       for (i=1;i<=NTRUPY;i++) {
                                if ( party[i].tipo != 0 ) {
                                    //if ( !(rand()%5) )
                                        party[i].lutando = 0;
                                } else break;
                            }
                    }


//// WORLD SPINNER

            SandMan = ((Lux+1)/(abs(Lux)+1)); // Mr.SandMan for midnite tracking
        // and now, ..
          Lux+=SOLARIS*((abs(Lux)+1)/(abs(Lux)+1)); // ..increment Lux (!)

                // blue palette phee-r00laz
                /* if ( !(Lux%5) ) {
                    if ( rand()%2 )
                        spiel+=11;
                    else
                        spiel-=11;
                    } */

        if ( SandMan != ((Lux+1)/(abs(Lux)+1)) || !Lux )
        {   // Mr.SandMan puts to dream / Mr.SandMan welcomes the Sun
           // Mr.SandMan makes midnight/midday
                // belowz, MIDNITE BELL

                    Lux+= SOLARIS*((Lux+1)/(abs(Lux)+1));

                    i=0;



// Mr.Sandman collector of corpses
//  SANDMAN = 1 enables it
if ( SANDMAN ) {

            int souls=0;

            for (k=1;k<=(N_CARTOLA)-1;k++)
                    if (cartola[k].camada == 3 && !cartola[k].vivo )
                                if ( souls < 100 ) {
                                    souls++;

                                strcpy(cartola[k].id, "");
                                strcpy(cartola[k].werk, "");
                                cartola[k].camada = 0;
                                cartola[k].tipo = 0;
                                cartola[k].select = 0;
                                if ( PALLANTIR == k )
                                    PALLANTIR = 0;
                                cartola[k].x = 0;
                                cartola[k].y = 0;
                                cartola[k].pxScr = 0;
                                cartola[k].pyScr = 0;
                                cartola[k].hp = 0;
                                cartola[k].nivel = 0;
                                cartola[k].sprite = 0;
                                cartola[k].flag = 0;
                                cartola[k].inix = 0;
                                cartola[k].iniy = 0;
                                cartola[k].vivo = 0;
                                cartola[k].Cronos = 0;
                                cartola[k].hostile = 0;
                                i++;
                        }   // erases cartola[k] data
                            // stops collecting after 100 corpses
            } // MR. Sandman
printf("[%d] corpse collector.\n", i);

                        if ( Lux > 0 ) {
                            dayO++; // its a new day, its a new life
                            Play_Snd("snd/midnite.wav");
                        } else Play_Snd("snd/spring.wav"); // midday

            }   // done MIDNIGHT/MIDDAY bell


                                } // END OF time/space tickz

} // end of Act_Tempo()

void T2gu ()
{

	int i;
	n_mapa = 1;
// ********************* INIT RPG STUFF
	srand(time(NULL));
	EGO.xvel = 0; EGO.yvel = 0; EGO.sprite = 0; EGO.hpmax = 1250; EGO.nivel = 9; EGO.hp = EGO.hpmax;
	EGO.atq = 3; EGO.def = 3; EGO.xp = 0; EGO.armor = 0; EGO.weapon = 0;
	EGO.gold = 0; EGO.wood = 0; EGO.tipo = SKINNER;
	tac.tic=1;tac.mov=1;tac.mag=0;tac.caflito=0;tac.atq=1;tac.atqkey=0;tac.gaia=0;

	for (i=0; i<=100; i++) // MISSION registers, for scripting
		mission[i]=0;

	for (i=1; i<=NTRUPY; i++) // PARTY init
	{
		party[i].tipo=0;
		party[i].x = 0;
		party[i].y = 0;
		party[i].pxScr = 0;
		party[i].pyScr = 0;
		party[i].hp = 0;
		party[i].hpmax = 0;
		party[i].xp = 0;
		party[i].nivel = 0;
		party[i].sprite = 0;
		party[i].vivo = 0;
		party[i].partykey = 1;
		party[i].lutando = 0;
		party[i].walkable = 0;
		party[i].select = 0;
	}

	for (i=0;i<=50; i++)    // mapsizes init
		map_offsets[i] = 0;

	Carrega_Mundo(); // allocate Cartola T2gu struct and make caches

		if ( Init_SDL(act_n) == 1 )
		printf("\nERR init SDL\n");

// sprite surfaces loader
	graficos[0] = IMG_Load("img/base.png");
	if (graficos[0] == NULL) printf("Problem loading sprite file:: img/base.png\n");

	graficos[1] = IMG_Load("img/top.png");
	if (graficos[1] == NULL) printf("Problem loading sprite file:: img/top.png\n");

	graficos[2] = IMG_Load("img/obj.png");
	if (graficos[2] == NULL) printf("Problem loading sprite file:: img/obj.png\n");

	graficos[3] = IMG_Load("img/cri.png");
	if (graficos[3] == NULL) printf("Problem loading sprite file:: img/cri.png\n");

	graficos[4] = IMG_Load("img/ego.png");
	if (graficos[4] == NULL) printf("Problem loading sprite file:: img/ego.png\n");

	graficos[5] = IMG_Load("img/item.png");
	if (graficos[5] == NULL) printf("Problem loading sprite file:: img/item.png\n");

	graficos[6] = IMG_Load("img/gauge.png");
	if (graficos[6] == NULL) printf("Problem loading sprite file:: img/gauge.png\n");

	caixatexto = IMG_Load("img/caixatexto.png");
	if (caixatexto == NULL) printf("Problem loading img/caixatexto.png\n");

	printf("Creating textures from surfaces...");

	cxatxt = SDL_CreateTextureFromSurface(window_renderer, caixatexto);

	texture[0] = SDL_CreateTextureFromSurface(window_renderer, graficos[0]);
	texture[1] = SDL_CreateTextureFromSurface(window_renderer, graficos[1]);
	texture[2] = SDL_CreateTextureFromSurface(window_renderer, graficos[2]);
	texture[3] = SDL_CreateTextureFromSurface(window_renderer, graficos[3]);
	texture[4] = SDL_CreateTextureFromSurface(window_renderer, graficos[4]);
	texture[5] = SDL_CreateTextureFromSurface(window_renderer, graficos[5]);
	texture[6] = SDL_CreateTextureFromSurface(window_renderer, graficos[6]);

    // map some colours
                COR.r = 255;COR.b = 255;COR.g = 200; // white
                CORv.r=255; CORv.b = 55; CORv.g = 0; // red
                CORg.r=55; CORg.b = 0; CORg.g = 200; // green
                CORy.r=255; CORy.b = 25; CORy.g = 255; // yellow

    // init TTF fonts
        font=TTF_OpenFont("img/fontz.ttf", 8); if(!font) { printf("TTF_OpenFont: %s\n", TTF_GetError()); }
        bigfont=TTF_OpenFont("img/fonty.ttf", 10); if(!bigfont) { printf("TTF_OpenFont: %s\n", TTF_GetError()); }

	// start in a silent way...
	musica = NULL;



//********************* END INIT STUFF

       Digue_Window(verzione);
	printf("init:: %s\n", verzione);

	if ( Novo_Mapa(n_mapa, 0, 0) != 1 ) act_n = 1;
	else { printf("\nProblema spawning 1st map.\n"); act_n = 0;
            fclose(arqpt); return; } // neverplayz



// MAIN GAME LOOP
	while (act_n != 0)
	{

     	Act_Tempo (); // input and itt/cycles/timekeeping

        if ( EGO.hp <= 0 ) { Play_Music("snd/music11.ogg"); Digue_Window("PLAYER is dead");

            SDL_RenderPresent(window_renderer);
            act_n=0;  break; }

if ( tac.tic )  {

    Input_Teclado();
        Desenha_Tudo();
	        Atualiza_Tudo();
         Desenha_stats();

            SDL_RenderPresent(window_renderer);

        }
        // test script trigger flag=54 on current tile occupied by player EGO.x EGO.y
		// of mapa[][], not cartola[]
if ( (mapa[EGO.y][EGO.x].flag == 54 || mapa[EGO.y][EGO.x].flag == 55 ) && !pegado )
		{ 	Act_T4c(NULL, -1);
			  pegado = 1;
			  rodascript = 0; }

	}
// ***END**** MAIN GAME LOOP

    Digue_Window("..TKS for playing, exit;");
    printf("..THANK YOU FOR PLAYING T2gu.. SDL_Quit();");
    SDL_Quit();

}
