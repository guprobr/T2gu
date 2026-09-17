#include <stdio.h>
#include <stdlib.h>
#include <SDL/SDL.h>
#include <SDL/SDL_image.h>

struct mapas {
	unsigned char base;
	unsigned char top;
	unsigned char obj;
	unsigned char cri;
	unsigned char flag;
};

struct player {
	int xpos;
	int ypos;
	int pxScr;
	int pyScr;
	int sprite;
};


	SDL_Surface *screen;
	SDL_Surface *graficos[4];

	SDL_Rect src, dest;
	struct player EGO;
	struct mapas **mapa;
	FILE *arqpt;
	int size_mapa, n_size=0, xpos=0, ypos=0;

int Init_SDL (SDL_Surface **tela)
{
        /* Initialize SDL’s video system and check for errors */
        if (SDL_Init(SDL_INIT_VIDEO) != 0) {
                printf("Unable to initialize SDL: %s\n", SDL_GetError() );
                return 1;
        }
       /* Make sure SDL_Quit gets called when the program exits! */
       atexit(SDL_Quit);
       /* Attempt to set a 640x480 hicolor video mode */
       *tela = SDL_SetVideoMode(640, 480, 8, SDL_HWSURFACE);
       if (*tela == NULL) {
                printf("Unable to set video mode: %s\n", SDL_GetError() );
                return 1;
       }
      /* If we got this far, everything worked */
      printf("Tela inicializada! 640x480 8 bits\n");

}


void Desenha2 (SDL_Surface **image, unsigned char tipo, int sprite, int i, int j)

{
        src.x = 50 * tipo;
        src.y = (50*sprite);
        src.w = 50;
        src.h = 50;
        dest.x = 50*i;
        dest.y = 50*j;
        dest.w = 50;
        dest.h = 50;

        SDL_BlitSurface (*image, &src, screen, &dest);
}

void Desenha_ego (SDL_Surface **image, int sprite)
{
	
       src.x = 0 + (50*sprite);
       src.y = 0;
       src.w = 50;
       src.h = 50;
       dest.x = 50*EGO.pxScr;
       dest.y = 50*EGO.pyScr;
       dest.w = 50;
       dest.h = 50;

       SDL_BlitSurface (*image, &src, screen, &dest);

}

int Carr_arq(char *arquivo)
{
        int ii, j;
        printf("Carregando %s...\n", arquivo);
        arqpt = fopen(arquivo, "r");
	fread(&size_mapa, sizeof(size_mapa), 1, arqpt);
	if ( (fread (&xpos, sizeof(xpos), 1, arqpt)) == 0) { printf("Erro: xpos\n"); return 1; }
	if ( (fread (&ypos, sizeof(ypos), 1, arqpt)) == 0) { printf("Erro: ypos\n"); return 1; }
        mapa = malloc(size_mapa*sizeof(struct Tijolos *));
	if ( mapa == NULL ) { printf("sem memória para alocar mapa: ponteiros.\n"); return 1; }
	for (ii=0; ii<=size_mapa-1; ii++)        
		mapa[ii] = malloc(size_mapa*sizeof(struct mapas));
	if ( mapa == NULL ) { printf("sem memória para alocar mapa: dados.\n"); return 1; }
	for (ii=0; ii<=size_mapa-1; ii++)        
		if ( fread (mapa[ii], size_mapa*sizeof(struct mapas), 1, arqpt) == 0) { printf("matriz zoada.\n"); return 1; }
	printf("%s carregado.\n", arquivo);
        fclose(arqpt);

}


int main ()
{
	SDL_Event eventu;

	int ii, jj, k=0, source = 0;
	int scrX = 0, scrY = 0;
	int act_n = 1, lido=0, n_flag=0;
	char n_flag_input[100];
	int n_size;

	Init_SDL(&screen);

	graficos[0] = IMG_Load("img/base.png");
        if (graficos == NULL) {
                printf("Não pode carregar arquivo de sprites\n");
        return 1;
        }
	graficos[1] = IMG_Load("img/top.png");
        if (graficos == NULL) {
                printf("Não pode carregar arquivo de sprites\n");
        return 1;
        }
	graficos[2] = IMG_Load("img/obj.png");
        if (graficos == NULL) {
                printf("Não pode carregar arquivo de sprites\n");
        return 1;
        }
	graficos[3] = IMG_Load("img/cri.png");
        if (graficos == NULL) {
                printf("Não pode carregar arquivo de sprites\n");
        return 1;
        }

	for (ii=0; ii<=3; ii++)
		SDL_SetColorKey(graficos[ii], SDL_SRCCOLORKEY, SDL_MapRGB(graficos[ii]->format, 0,0,255));


	EGO.xpos = 2; EGO.ypos = 3; EGO.sprite = 0;
	EGO.pxScr = 2; EGO.pyScr = 3;

	Carr_arq("map.map");



	while (act_n != 0)
	{
		
		if (SDL_PollEvent(&eventu) == 1)
		{
			if ( eventu.type == SDL_QUIT) act_n=0;
                        if ( eventu.type == SDL_KEYDOWN )
                        {
                                switch ( eventu.key.keysym.sym )
                                {
					case SDLK_ESCAPE:
					act_n=0;
					break;
					case SDLK_RIGHT:
					EGO.xpos++; EGO.pxScr++; 
					printf("X:%dY:%d\n", EGO.xpos, EGO.ypos);
					break;

					case SDLK_LEFT:
					EGO.xpos--; EGO.pxScr--;
					printf("X:%dY:%d\n", EGO.xpos, EGO.ypos);
					break;

					case SDLK_UP:
					EGO.ypos--; EGO.pyScr--;
					printf("X:%dY:%d\n", EGO.xpos, EGO.ypos);
					break;

					case SDLK_DOWN:
					EGO.ypos++; EGO.pyScr++; 
					printf("X:%dY:%d\n", EGO.xpos, EGO.ypos);
					break;

					case SDLK_r:
					EGO.sprite++;
					break;

					case SDLK_e:
					EGO.sprite--;
					if (EGO.sprite < 0) EGO.sprite = 0;
					break;

					case SDLK_b:
					printf ("Salvando mapa.map\n");
					arqpt = fopen("mapa.map", "wb");
					fwrite ( &size_mapa, sizeof(size_mapa), 1, arqpt);
					fwrite ( &xpos, sizeof(xpos), 1, arqpt);
					fwrite ( &ypos, sizeof(ypos), 1, arqpt);
					for (ii=0; ii<=size_mapa-1; ii++)        
						if ( fwrite (mapa[ii], size_mapa*sizeof(struct mapas), 1, arqpt) == 0) { printf("erro gravando matriz.\n"); return 1; }
					fclose(arqpt);
					break;

					case SDLK_1:
					source = 0;
					break;

					case SDLK_2:
					source = 2;
					break;

					case SDLK_3:
					source = 3;
					break;

					case SDLK_4:
					source = 1;
					break;
				
					case SDLK_5:
					source = -1;
					break;

					case SDLK_SPACE:
					if (source == 0)
						mapa[EGO.ypos][EGO.xpos].base = EGO.sprite;
					if (source == 2)
						mapa[EGO.ypos][EGO.xpos].obj = EGO.sprite;
					if (source == 3)
						mapa[EGO.ypos][EGO.xpos].cri = EGO.sprite;
					if (source == -1)
						mapa[EGO.ypos][EGO.xpos].flag = n_flag;
					if (source == 1)
						mapa[EGO.ypos][EGO.xpos].top = EGO.sprite;
					break;

					case SDLK_n:
					for(ii=0; ii<=size_mapa-1;ii++)
						free(mapa[ii]);
					free(mapa);
					size_mapa = n_size;
					mapa = malloc(size_mapa*sizeof(struct Tijolos *));
					if ( mapa == NULL ) { printf("sem memória para alocar mapa: ponteiros.\n"); return 1; }
					for (ii=0; ii<=size_mapa-1; ii++)        
					mapa[ii] = malloc(size_mapa*sizeof(struct mapas));
					if ( mapa == NULL ) { printf("sem memória para alocar mapa: dados.\n"); return 1; }
					for (ii=0; ii<=size_mapa-1; ii++)
						for (jj=0; jj<=size_mapa-1;jj++)
						{
							mapa[ii][jj].base = EGO.sprite;
							mapa[ii][jj].top = 0;
							mapa[ii][jj].obj = 0;
							mapa[ii][jj].cri = 0;
							mapa[ii][jj].flag = 0;
						}
					break;
					case SDLK_t:
						EGO.sprite-=10;
					break;
					case SDLK_u:
						EGO.sprite+=10;
					break;

					case SDLK_f:
						k=0;lido=0;
						while (lido != 1) 
  						{
							SDL_WaitEvent(&eventu);

							if (eventu.type == SDL_KEYDOWN)
							switch (eventu.key.keysym.sym)
							{
								case SDLK_RETURN:
								lido = 1;
								n_flag_input[k] = '\0';
								n_flag = atoi(n_flag_input);
								printf("FLAG: %d\n\n\n", n_flag);
								break;
								case SDLK_0:
								n_flag_input[k] = '0';
								k++;
								break;
								case SDLK_1:
								n_flag_input[k] = '1';
								k++;
								break;
								case SDLK_2:
								n_flag_input[k] = '2';
								k++;
								break;
								case SDLK_3:
								n_flag_input[k] = '3';
								k++;
								break;
								case SDLK_4:
								n_flag_input[k] = '4';
								k++;
								break;
								case SDLK_5:
								n_flag_input[k] = '5';
								k++;
								break;
								case SDLK_6:
								n_flag_input[k] = '6';
								k++;
								break;
								case SDLK_7:
								n_flag_input[k] = '7';
								k++;
								break;
								case SDLK_8:
								n_flag_input[k] = '8';
								k++;
								break;
								case SDLK_9:
								n_flag_input[k] = '9';
								k++;
								break;
							}
						} // while lido!=1
					break;

					case SDLK_s:
						k =0; lido=0;
						while (lido != 1) 
  						{
							SDL_WaitEvent(&eventu);

							if (eventu.type == SDL_KEYDOWN)
							switch (eventu.key.keysym.sym)
							{
								case SDLK_RETURN:
								lido = 1;
								n_flag_input[k] = '\0';
								n_size = atoi(n_flag_input);
								printf("SIZE_MAPA: %d\n\n\n", n_size);
								break;
								case SDLK_0:
								n_flag_input[k] = '0';
								k++;
								break;
								case SDLK_1:
								n_flag_input[k] = '1';
								k++;
								break;
								case SDLK_2:
								n_flag_input[k] = '2';
								k++;
								break;
								case SDLK_3:
								n_flag_input[k] = '3';
								k++;
								break;
								case SDLK_4:
								n_flag_input[k] = '4';
								k++;
								break;
								case SDLK_5:
								n_flag_input[k] = '5';
								k++;
								break;
								case SDLK_6:
								n_flag_input[k] = '6';
								k++;
								break;
								case SDLK_7:
								n_flag_input[k] = '7';
								k++;
								break;
								case SDLK_8:
								n_flag_input[k] = '8';
								k++;
								break;
								case SDLK_9:
								n_flag_input[k] = '9';
								k++;
								break;
							}
						} // while lido!=1
					break;

					case SDLK_x:
						k=0;lido=0;
						while (lido != 1) 
  						{
							SDL_WaitEvent(&eventu);

							if (eventu.type == SDL_KEYDOWN)
							switch (eventu.key.keysym.sym)
							{
								case SDLK_RETURN:
								lido = 1;
								n_flag_input[k] = '\0';
								xpos = atoi(n_flag_input);
								printf("xpos: %d\n\n\n", xpos);
								break;
								case SDLK_0:
								n_flag_input[k] = '0';
								k++;
								break;
								case SDLK_1:
								n_flag_input[k] = '1';
								k++;
								break;
								case SDLK_2:
								n_flag_input[k] = '2';
								k++;
								break;
								case SDLK_3:
								n_flag_input[k] = '3';
								k++;
								break;
								case SDLK_4:
								n_flag_input[k] = '4';
								k++;
								break;
								case SDLK_5:
								n_flag_input[k] = '5';
								k++;
								break;
								case SDLK_6:
								n_flag_input[k] = '6';
								k++;
								break;
								case SDLK_7:
								n_flag_input[k] = '7';
								k++;
								break;
								case SDLK_8:
								n_flag_input[k] = '8';
								k++;
								break;
								case SDLK_9:
								n_flag_input[k] = '9';
								k++;
								break;
							}
						} // while lido!=1
					break;
					case SDLK_h:
					mapa[EGO.ypos][EGO.xpos].obj = 69;
					mapa[EGO.ypos][EGO.xpos+1].obj = 70;
					mapa[EGO.ypos][EGO.xpos-1].obj = 68;
					mapa[EGO.ypos+1][EGO.xpos].obj = 72;
					mapa[EGO.ypos+1][EGO.xpos+1].obj = 73;
					mapa[EGO.ypos+1][EGO.xpos-1].obj = 71;
					mapa[EGO.ypos-1][EGO.xpos].obj = 66;
					mapa[EGO.ypos-1][EGO.xpos+1].obj = 67;
					mapa[EGO.ypos-1][EGO.xpos-1].obj = 65;
					mapa[EGO.ypos-2][EGO.xpos].obj = 63;
					mapa[EGO.ypos-2][EGO.xpos+1].obj = 64;
					mapa[EGO.ypos-2][EGO.xpos-1].obj = 62;
					mapa[EGO.ypos-3][EGO.xpos].obj = 75;
					mapa[EGO.ypos-3][EGO.xpos+1].obj = 76;
					mapa[EGO.ypos-3][EGO.xpos-1].obj = 74;
					mapa[EGO.ypos-4][EGO.xpos].obj = 75;
					mapa[EGO.ypos-4][EGO.xpos+1].obj = 78;
					mapa[EGO.ypos-4][EGO.xpos-1].obj = 77;
					mapa[EGO.ypos-5][EGO.xpos].obj = 79;
					break;
			
					case SDLK_j:
					mapa[EGO.ypos][EGO.xpos].top = 133;
					mapa[EGO.ypos][EGO.xpos+1].top = 134;
					mapa[EGO.ypos][EGO.xpos-1].top = 132;
					mapa[EGO.ypos-1][EGO.xpos].top = 130;
					mapa[EGO.ypos-1][EGO.xpos+1].top = 131;
					mapa[EGO.ypos-1][EGO.xpos-1].top = 129;
					mapa[EGO.ypos+1][EGO.xpos].obj = 106;
					break;

					case SDLK_k:
					mapa[EGO.ypos][EGO.xpos].top = 139;
					mapa[EGO.ypos][EGO.xpos+1].top = 140;
					mapa[EGO.ypos][EGO.xpos-1].top = 138;
					mapa[EGO.ypos-1][EGO.xpos].top = 136;
					mapa[EGO.ypos-1][EGO.xpos+1].top = 137;
					mapa[EGO.ypos-1][EGO.xpos-1].top = 135;
					mapa[EGO.ypos+1][EGO.xpos].obj = 143;
					break;

					case SDLK_y:
						k=0;lido=0;
						while (lido != 1) 
  						{
							SDL_WaitEvent(&eventu);

							if (eventu.type == SDL_KEYDOWN)
							switch (eventu.key.keysym.sym)
							{
								case SDLK_RETURN:
								lido = 1;
								n_flag_input[k] = '\0';
								ypos = atoi(n_flag_input);
								printf("ypos: %d\n\n\n", ypos);
								break;
								case SDLK_0:
								n_flag_input[k] = '0';
								k++;
								break;
								case SDLK_1:
								n_flag_input[k] = '1';
								k++;
								break;
								case SDLK_2:
								n_flag_input[k] = '2';
								k++;
								break;
								case SDLK_3:
								n_flag_input[k] = '3';
								k++;
								break;
								case SDLK_4:
								n_flag_input[k] = '4';
								k++;
								break;
								case SDLK_5:
								n_flag_input[k] = '5';
								k++;
								break;
								case SDLK_6:
								n_flag_input[k] = '6';
								k++;
								break;
								case SDLK_7:
								n_flag_input[k] = '7';
								k++;
								break;
								case SDLK_8:
								n_flag_input[k] = '8';
								k++;
								break;
								case SDLK_9:
								n_flag_input[k] = '9';
								k++;
								break;
							}
						} // while lido!=1
					break;
					
				} //switch
			} // eventu.type
		} // SDL_PollEvent
		
		// Se andar para a beira da tela, incrementar ou decrementar o SCROLL
		
		if (EGO.pyScr >= 10) { scrY++; EGO.pyScr = 9; }
		if (EGO.pyScr < 0) { scrY--; EGO.pyScr = 0; }
		if (EGO.pxScr >= 10) { scrX++; EGO.pxScr = 9; }
		if (EGO.pxScr < 0) { scrX--; EGO.pxScr = 0; }

		if (scrX < 0) scrX = 0;
		if (scrX > size_mapa-10) scrX = size_mapa-10;
		if (scrY < 0) scrY = 0;
		if (scrY > size_mapa-10) scrY = size_mapa-10;
		if (EGO.xpos < 0) EGO.xpos = 0;
		if (EGO.ypos < 0) EGO.ypos = 0;
		if (EGO.xpos > size_mapa-1) EGO.xpos = size_mapa-1;
		if (EGO.ypos > size_mapa-1) EGO.ypos = size_mapa-1;



		//DESENHAR OS MAPAS
		//// Desenha o fundo      
		for (jj=0; jj <=9; jj++)
			for (ii=0; ii <=9; ii++)
				if (mapa[jj+scrY][ii+scrX].base )
				Desenha2 (&(graficos[0]), mapa[jj+scrY][ii+scrX].base, 0, ii, jj);

		for (jj=0; jj <=9; jj++)
	                for (ii=0; ii <=9; ii++)
				if (mapa[jj+scrY][ii+scrX].top >= 20 && mapa[jj+scrY][ii+scrX].top <= 27)
			        	Desenha2 (&(graficos[1]), mapa[jj+scrY][ii+scrX].top, 0, ii, jj);
		

                // Desenha objetos e criaturas
		for (jj=0; jj <=9; jj++)
			for (ii=0; ii <=9; ii++)
				Desenha2 (&(graficos[2]), mapa[jj+scrY][ii+scrX].obj, 0, ii, jj);

                                                                                                                                                                                                                                                                          // Desenha bordas              
		//                               
                for (jj=0; jj <=9; jj++)
	                for (ii=0; ii <=9; ii++) 
			        Desenha2 (&(graficos[3]), mapa[jj+scrY][ii+scrX].cri, 0, ii, jj);

		for (jj=0; jj <=9; jj++)
	                for (ii=0; ii <=9; ii++)
				if (!(mapa[jj+scrY][ii+scrX].top >= 20 && mapa[jj+scrY][ii+scrX].top <= 27))
			        Desenha2 (&(graficos[1]), mapa[jj+scrY][ii+scrX].top, 0, ii, jj);

		for (jj=0; jj <=9; jj++)
	                for (ii=0; ii <=9; ii++) 
				if (mapa[jj+scrY][ii+scrX].flag != 0 )
				        Desenha2 (&(graficos[1]), 2, 0, ii, jj);


		
		Desenha_ego( &(graficos[source]), EGO.sprite );
				 
		SDL_Flip(screen);




	} // while act_n != 0

} // Main
