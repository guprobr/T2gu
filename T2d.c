// T2d.c by gu.pro.br 2021
/* This code deals with all rendering to SDL screen surface */
/* ..also Input control                                                  */

int Init_SDL (unsigned char act_n)
{


     //Initialize SDL
    if( SDL_Init( SDL_INIT_VIDEO ) < 0 ) {
        printf( "SDL could not initialize! SDL_Error: %s\n", SDL_GetError() );
        return 3;
    }


        // Create an application window with the following settings:
    window = SDL_CreateWindow(
        "T2gu engine by GU.pro.br",                  // window title
        SDL_WINDOWPOS_UNDEFINED,           // initial x position
        SDL_WINDOWPOS_UNDEFINED,           // initial y position
        SCREEN_WIDTH,                               // width, in pixels
        SCREEN_HEIGHT,                               // height, in pixels
        SDL_WINDOW_OPENGL                  // flags - see below
    );

    SDL_SetWindowFullscreen(window, SDL_WINDOW_FULLSCREEN );

    window_renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED);

    // Check that the window was successfully created
    if (window == NULL) {
        // In the case that the window could not be made...
        printf("Could not create window: %s\n", SDL_GetError());
        return 1;
    }



 tela = SDL_GetWindowSurface( window );
	printf("T2gu - gu.pro.br init!\n");

	// Inicializar sistema de fontes
	if (TTF_Init() != 0) {
		printf("TTF_Init: %s\n", SDL_GetError() );
		return 1;
		}

	else printf("TTF inicializado!\n");

	// Inicializar sistema de som
	if( Mix_OpenAudio( 96000, MIX_DEFAULT_FORMAT, 1, 5250 ) == -1 ) { printf("Erro inicializando SDL_mixer!\n"); }



	else { printf("SOM inicializado!\n");
                Mix_VolumeMusic(MIX_MAX_VOLUME/4);
                Mix_Volume(-1,2*MIX_MAX_VOLUME/3);
        }

	return 0;

}


void Desenha_radar ( int iii, int jjj, int specialK )
{


	src.x = 0;
    src.y = 0;

        src.w = 3;
        src.h = 3;

                dest.x = SCREEN_WIDTH-(SCREEN_WIDTH/6)+((iii)-(rx));
                dest.y = SCREEN_HEIGHT-(SCREEN_HEIGHT/2)+((jjj)-(ry));

      dest.w = 2;
      dest.h = 2;

        if ( cartola[specialK].hostile)
            SDL_SetTextureColorMod(texture[6],255,0,0);

      SDL_RenderCopy(window_renderer, texture[6], &src, &dest);

            SDL_SetTextureColorMod(texture[6],255,255,255);

}

void Desenha_ether (unsigned char tipo, float i, float j, SDL_Texture *grafic)
{
    unsigned int jYea = (int)(ceil(j+pysc)), iYea = (int)(ceil(i+pxsc)); // :D

// etherer
        src.x = 50 * tipo;
        src.y = 0;
        src.w = 50;
        src.h = 50;

        dest.x = ((i+1)*QTO);
        dest.y = ((j+1)*QTO);
        dest.h = ((yakka)+(QTO)+((abs(ether[jYea][iYea].tipo)+(mapa[jYea][iYea].base%GANGHO)*yakka))*(QTO/10))/3;
        dest.w = ((1.5*yakka)+(QTO)+((abs(ether[jYea][iYea].tipo)+(mapa[jYea][iYea].base%GANGHO)*yakka))*(QTO/10))/3;

SDL_SetTextureColorMod(grafic, \
                84+((((abs(ether[jYea][iYea].tipo*ether[jYea][iYea].tipo))*60)/(1+abs(ether[jYea][iYea].tipo)))%8)+(32+(4*((mapa[jYea][iYea].base+1)%GANGHO))),    \
                96+((((abs(ether[jYea][iYea].tipo*ether[jYea][iYea].tipo))*45)/(1+abs(ether[jYea][iYea].tipo)))%8)+(32+(4*((mapa[jYea][iYea].base+1)%GANGHO))),     \
                200);

//((Lux%3)*(-1)*Lux)+(Lux)

        SDL_RenderCopyEx(window_renderer, grafic, &src, &dest,(jYea*iYea),NULL,SDL_FLIP_NONE);


}

void Desenha_terra (unsigned char tipo, char sprite, float i, float j, int  WALLA, SDL_Texture *grafic)
{

unsigned int jYea = (int)(ceil(j+pysc)), iYea = (int)(ceil(i+pxsc)); // :D

   src.x = 50 * tipo;
   src.y = 50*abs(sprite);

        src.w = 50;
        src.h = 50;

                dest.x = ((i+(-1*ZZy))*QTO);
                dest.y = ((j+ZZy)*QTO);

      dest.w = (QTO)+(( 1 + mapa[jYea][iYea].base%GANGHO)*WALLA*(QTO/10));
      dest.h = (QTO)+(( 1 + mapa[jYea][iYea].base%GANGHO)*WALLA*(QTO/10));

                   SDL_SetTextureColorMod(grafic, \
                8*(((ether[jYea][iYea].tipo*ether[jYea][iYea].tipo))%8)+((((mapa[jYea][iYea].base+1)*3))+abs(Lux))+64,    \
                7*(((ether[jYea][iYea].tipo*ether[jYea][iYea].tipo))%8)+((((mapa[jYea][iYea].base+1)*3))+abs(Lux))+72,     \
                abs(spiel));

                    SDL_RenderCopyEx(window_renderer, grafic, &src, &dest,(jYea*iYea)%180,NULL,SDL_FLIP_NONE);

                 dest.w *= 0.13; dest.h *= 0.13;

                 SDL_RenderCopyEx(window_renderer, grafic, &src, &dest,(jYea*iYea),NULL,SDL_FLIP_NONE);

                    dest.x += QTO/2;

                SDL_RenderCopyEx(window_renderer, grafic, &src, &dest,(jYea*iYea)%90,NULL,SDL_FLIP_NONE);

/*
                SDL_SetTextureColorMod(grafic, \
                7*(((ether[jYea][iYea].tipo*ether[jYea][iYea].tipo))%8)+((((mapa[jYea][iYea].base+1)*3))+abs(Lux))+64,    \
                7*(((ether[jYea][iYea].tipo*ether[jYea][iYea].tipo))%8)+((((mapa[jYea][iYea].base+1)*3))+abs(Lux))+64,     \
                abs(spiel));
*/
                    dest.y += QTO/2;

                SDL_RenderCopyEx(window_renderer, grafic, &src, &dest,((jYea*iYea)%90),NULL,SDL_FLIP_NONE);

                    dest.x -= QTO/2;

                SDL_RenderCopyEx(window_renderer, grafic, &src, &dest,((jYea*iYea)%280),NULL,SDL_FLIP_NONE);


}

void Desenha (unsigned char tipo, char sprite, float i, float j, int  WALLA, SDL_Texture *grafic)
{

unsigned int jYea = (int)(ceil(j+pysc)), iYea = (int)(ceil(i+pxsc)); // :D

   src.x = 50 * tipo;
   src.y = 50*abs(sprite);

        src.w = 50;
        src.h = 50;


// /*            shadow /////////////////////////////
	dest.x = ((i+(-1*ZZy))*QTO)+((abs(Lux)/Lux));
	dest.y = ((j+ZZy)*QTO)+((abs(Lux)/Lux));

    unsigned char wingz = 1;

	if ( grafic == texture[2] )
        wingz = 4;
    else wingz = 2;

	   dest.w = (QTO+(32/abs(Lux))+(mapa[jYea][iYea].base%GANGHO))*sqrt(wingz);
       dest.h = (QTO+(32/abs(Lux))+(mapa[jYea][iYea].base%GANGHO))*2;

			SDL_SetTextureColorMod(grafic, \
			0, 0, 0);       // paint it black

            	 SDL_SetTextureAlphaMod(grafic, 28); // make transparent:
                                            // note: sux perf (?)

    SDL_RenderCopyEx(window_renderer, grafic, &src, &dest,Lux,NULL,SDL_FLIP_NONE);

////////////////////////////////////// end shadow


                dest.x = ((i+(-1*ZZy))*QTO);
                dest.y = ((j+ZZy)*QTO);

      dest.w = (QTO)+(( 1 + mapa[jYea][iYea].base%GANGHO)*WALLA*(QTO/10))*0.5;
      dest.h = (QTO)+(( 1 + mapa[jYea][iYea].base%GANGHO)*WALLA*(QTO/10))*0.5;

    if ( abs(sprite) == 10 )
        SDL_SetTextureAlphaMod(grafic, 128);
    else
        SDL_SetTextureAlphaMod(grafic, 255);

            SDL_SetTextureColorMod(grafic, \
                3*(((1+(ether[jYea][iYea].tipo*ether[jYea][iYea].tipo))/(1+abs(ether[jYea][iYea].tipo)))%8)+((((mapa[jYea][iYea].base+1)%GANGHO))+abs(Lux))+64,    \
                3*(((1+(ether[jYea][iYea].tipo*ether[jYea][iYea].tipo))/(1+abs(ether[jYea][iYea].tipo)))%8)+((((mapa[jYea][iYea].base+1)%GANGHO))+abs(Lux))+64,     \
                220-abs(Lux));

                if ( grafic == texture[3] )
                {
                    dest.w *= sqrt(2);
                    dest.h *= sqrt(3);
                }

            SDL_RenderCopy(window_renderer, grafic, &src, &dest);

}

void Desenha_Tudo()
{

	int ii=0, jj=0;

SDL_RenderClear(window_renderer);

            src.x = 0;
            src.y = 0;
            src.w = 50;
            src.h = 50;
            dest.w = SCREEN_WIDTH;
            dest.h = SCREEN_HEIGHT;

SDL_SetTextureColorMod(texture[0], abs(Lux)+32,abs(Lux)+32,abs(Lux)+32);
SDL_RenderCopy(window_renderer, texture[0], &src, NULL);


// DRAW BASE TERRAIN LAYER
for (jj=0; jj< ALOHA; jj++)
		for (ii=0; ii< ALOHA*1.5; ii++)
			if ( ii+scrx+1<=size_mapa-1 && jj+scry+1<=size_mapa-1 )
            {
                Desenha_terra (0, 0, ii-(pxsc-scrx), jj-(pysc-scry), yakka*3, texture[0]);
                if ( mapa[jj+scry][ii+scrx].base )
                    Desenha_terra ((mapa[jj+scry][ii+scrx].base%GANGHO), 0, ii-(pxsc-scrx), jj-(pysc-scry), yakka*2, texture[0]);
                if ( ether[jj+scry][ii+scrx].tipo < 0 && !mapa[jj+scry][ii+scrx].obj ) // draw wasser
                    Desenha_ether (WASSER, ii-(pxsc-scrx), jj-(pysc-scry), texture[1]);
                if ( ether[jj+scry][ii+scrx].tipo > 0 ) // draw fireballz
				Desenha_ether (FIRE, ether[jj+scry][ii+scrx].pxScr-(pxsc), ether[jj+scry][ii+scrx].pyScr-(pysc), texture[1]);

            }

// obj layer and TOP layers inside Atualiza_Tudo();
// WILL draw each creature/item inside "for" (cartola[k]) main engine loop
// also on Atualiza_Tudo() and
// at the end of Atualiza_Tudo, will DRAW party, EGO;

}

void Digue (const char howda[])
{

	int ii,i,j,jj=0,k;

	i=0; k=0;
	while ( i <= strlen(howda) )
	{
		if ( k > 68 && howda[i] != ' ' && jj < 50)
		{
			while ( howda[i] != ' ' && i > 0 )
			{  jj++; i--; k--; iDito[iTexto][k] = ' '; }
			iDito[iTexto][47] = ' ';
			iDito[iTexto][48] = '\0';

			if ( jj > 66 ) { iTexto++; jj=0; }
			k=0;

		}
		if (iTexto > 21) {
			for (ii=0;ii<=30;ii++)
				for (j=0;j<68;j++)
					iDito[ii][j] = iDito[ii+1][j];
			iTexto = 21;
		}
		iDito[iTexto][k] = howda[i];
		i++; k++;
		if ( k > 67 ) { iDito[iTexto][68] = '\0'; jj=0; k=0; iTexto++; }

	}
	iTexto++;

	if (iTexto > 21) {
		for (ii=0;ii<=20;ii++)
			for (j=0;j<68;j++)
				iDito[ii][j] = iDito[ii+1][j];
		iTexto = 21;
	}

}

void Digue_Window (const char howda[])
{
	int iiTexto = 0;
	int i,j=0,k, lido=0;
	char iiDito[34][50] = { "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""};


		k=0; i=0;

	while ( i <= strlen(howda) )
	{
		if ( k > 47 && howda[i] != ' ' && j < 48 )
		{
			while ( howda[i] != ' ' && i != 0 )
			{ j++; i--; k--; iiDito[iiTexto][k] = ' '; }
			iiDito[iiTexto][48] = ' ';
			iiDito[iiTexto][49] = '\0';
			if (j < 33 ) { iiTexto++; j=0; } k=0;
		}
		iiDito[iiTexto][k] = howda[i];
		k++; i++;
		if ( k > 48 ) { iiDito[iiTexto][49] = '\0'; k=0; j=0; iiTexto++; }
	}

	src.x = 0; src.y =0; dest.x = SCREEN_WIDTH/4; dest.y = SCREEN_HEIGHT/2;
		src.w = 300; dest.w = 400; src.h = 200; dest.h = 200;


	SDL_RenderCopy(window_renderer, cxatxt, &src, &dest);

	for (i=0;i <= 19;i++) {
		texto=TTF_RenderUTF8_Solid(bigfont, iiDito[i], COR);

			textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

		dest.x = SCREEN_WIDTH/4 + 5;
		dest.y = (SCREEN_HEIGHT/2) + (i*15);


        TTF_SizeText(bigfont, iiDito[i], &w, &h);
        dest.w = w;
        dest.h = h;
		SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


		SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
		texto = NULL;
	}

        SDL_RenderPresent(window_renderer);


while (lido != 1)
	{


		SDL_WaitEvent(&Evento);

		if (Evento.type == SDL_KEYDOWN)
			switch (Evento.key.keysym.sym)
			{
				case SDLK_RETURN:
					lido = 1;
					break;
			}
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

void Desenha_stats ()
{
	char statu[500];
	unsigned int tempo_hora, tempo_min, tempo_seg, i;

	if ( !StatuS ) //  TAB
	{
/////// party stats
	sprintf(statu, "%d", trupyscry);
texto = TTF_RenderUTF8_Solid (bigfont, statu, CORv);
				dest.y=SCREEN_HEIGHT-15;
				dest.x=250;

        textexto = SDL_CreateTextureFromSurface(window_renderer, texto);


                 TTF_SizeText(bigfont, statu, &w, &h);
                dest.w = w;
                dest.h = h;
				SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


				SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
				texto = NULL;
                                // zero phonic blast party stats yey
		for(i=(5*trupyscry)-5; i<=4+(trupyscry*5); i++)
			if ( party[i].tipo != 0 )
			{




				src.x=10; src.y=10; src.w=(strlen(Livro[party[i].tipo].nome)+strlen(statu))*5; src.h=50; dest.x=SCREEN_WIDTH-(SCREEN_WIDTH/4); dest.y=(50*i);

// party portrait
                src.y = 0; src.x = 50*party[i].tipo; src.w=50; src.h=50;
                dest.y=52*(i/(5*trupyscry)) +SCREEN_HEIGHT-(SCREEN_HEIGHT/7);
                dest.x = 50+(96*((i%5)));
                    SDL_SetTextureAlphaMod(texture[3], 84);
                    SDL_RenderCopy(window_renderer, texture[3], &src, &dest);

    // member name
				texto = TTF_RenderUTF8_Solid (bigfont, Livro[party[i].tipo].nome, CORv);
				dest.y=52*(i/(5*trupyscry)) +SCREEN_HEIGHT-(SCREEN_HEIGHT/7);
				dest.x=50+(96*((i%5)));

					textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

                 TTF_SizeText(bigfont, Livro[party[i].tipo].nome, &w, &h);
                dest.w = w;
                dest.h = h;
				SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


				SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
				texto = NULL;

				sprintf(statu, "%d/%d", party[i].hp, party[i].hpmax);
                texto = TTF_RenderUTF8_Solid (bigfont, statu, COR);

					textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

				dest.y=52*(i/(5*trupyscry)) +SCREEN_HEIGHT-(SCREEN_HEIGHT/7)+10;
				dest.x=50+(96*((i%5)));
                 TTF_SizeText(bigfont, statu, &w, &h);
                    dest.w = w;
                    dest.h = h;
				SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


				SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
				texto = NULL;
				sprintf(statu, "XP:%d", party[i].xp);
				texto = TTF_RenderUTF8_Solid (bigfont, statu, COR);
				dest.y=52*(i/(5*trupyscry)) +SCREEN_HEIGHT-(SCREEN_HEIGHT/7)+20;
				dest.x=50+(96*((i%5)));

					textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

                 TTF_SizeText(bigfont, statu, &w, &h);
                    dest.w = w;
                    dest.h = h;
				SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


				SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
				texto = NULL;
				sprintf(statu, "Lv %d", party[i].nivel);
				texto = TTF_RenderUTF8_Solid (bigfont, statu, COR);

					textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

				dest.y=52*(i/(5*trupyscry)) +SCREEN_HEIGHT-(SCREEN_HEIGHT/7)+30;
				dest.x=50+(96*((i%5)));

                 TTF_SizeText(bigfont, statu, &w, &h);
                    dest.w = w;
                    dest.h = h;
				SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


				SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;

				texto = NULL;



			}


// console box
 // background
            src.x = 0;
            src.y = 0;
            src.w = 5;
            src.h = 5;
            dest.x = SCREEN_WIDTH-(SCREEN_WIDTH/3);
            dest.y = 50;
            dest.w = (SCREEN_WIDTH/3);
            dest.h = (SCREEN_HEIGHT/3);

                SDL_RenderCopy(window_renderer, cxatxt, &src, &dest);
// console text
	for (i=0;i < 21;i++) {
		texto=TTF_RenderUTF8_Solid(bigfont, iDito[i], COR);

			textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

		dest.x = SCREEN_WIDTH-(SCREEN_WIDTH/3);
		dest.y = 50 + (i*12);

         TTF_SizeText(bigfont, iDito[i], &w, &h);
                    dest.w = w;
                    dest.h = h;
		SDL_RenderCopy(window_renderer, textexto, NULL, &dest);

            SDL_FreeSurface(texto);
            SDL_DestroyTexture(textexto); textexto = NULL;
            texto = NULL;
        }

// player portrait
                src.y = 0;
                src.x = 50*EGO.tipo;
                src.w=50;
                src.h = 50;
                dest.y=0;
                dest.x =0;
                dest.w = 200;
                dest.h = 200;


				  SDL_SetTextureAlphaMod(texture[3], 100);

				SDL_RenderCopy(window_renderer, texture[3], &src, &dest);

    }   // TAB

        // leftside vertical border
            SDL_SetTextureColorMod(cxatxt, \
                    250, \
                    250, \
                    0);
            src.x = 0;
            src.y = 0;
            src.w = 2;
            src.h = 2;
            dest.x = 0;
            dest.y = 0;
            dest.w = QTO;
            dest.h = SCREEN_HEIGHT;

            SDL_RenderCopy(window_renderer, cxatxt, &src, &dest);
        // rightside vertical border
            SDL_SetTextureColorMod(cxatxt, \
                    250, \
                    250, \
                    0);
            src.x = 0;
            src.y = 0;
            src.w = 2;
            src.h = 2;
            dest.x = SCREEN_WIDTH-QTO;
            dest.y = 0;
            dest.w = QTO;
            dest.h = SCREEN_HEIGHT;

            SDL_RenderCopy(window_renderer, cxatxt, &src, &dest);

    // top horizontal border
    SDL_SetTextureColorMod(cxatxt, \
                    250, \
                    250, \
                    0);
            src.x = 0;
            src.y = 0;
            src.w = 50;
            src.h = 50;
            dest.x = 0;
            dest.y = 0;
            dest.w = SCREEN_WIDTH-100;
            dest.h = QTO;

    SDL_RenderCopy(window_renderer, cxatxt, &src, &dest);



// player stats

	sprintf(statu, "HP: %d/%d ", EGO.hp, EGO.hpmax);
	texto = TTF_RenderUTF8_Solid (bigfont, statu, CORv);
		textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

	dest.x=5;
	dest.y=50;

     TTF_SizeText(bigfont, statu, &w, &h);
                    dest.w = w;
                    dest.h = h;
	SDL_RenderCopy(window_renderer, textexto, NULL, &dest);

	SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
	texto = NULL;

	sprintf(statu, "XP: %ld", EGO.xp);

	texto = TTF_RenderUTF8_Solid (bigfont, statu, CORg);
	dest.x=100;
	dest.y=5;

		textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

         TTF_SizeText(bigfont, statu, &w, &h);
                    dest.w = w;
                    dest.h = h;
	SDL_RenderCopy(window_renderer, textexto, NULL, &dest);

	SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
	texto = NULL;

	sprintf(statu, "LV %d", EGO.nivel);

	texto = TTF_RenderUTF8_Solid (bigfont, statu, CORg);
	dest.x=150;
	dest.y=5;

		textexto = SDL_CreateTextureFromSurface(window_renderer, texto);


         TTF_SizeText(bigfont, statu, &w, &h);
                    dest.w = w;
                    dest.h = h;
	SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


	SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
	texto = NULL;

	sprintf(statu, "gold: %d", EGO.gold);

	texto = TTF_RenderUTF8_Solid (bigfont, statu, CORy);
	dest.x=bigW-250;
	dest.y=5;

		textexto = SDL_CreateTextureFromSurface(window_renderer, texto);


         TTF_SizeText(bigfont, statu, &w, &h);
                    dest.w = w;
                    dest.h = h;
	SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


	SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
	texto = NULL;

	sprintf(statu, "wood)%d ", EGO.wood);

	texto = TTF_RenderUTF8_Solid (bigfont, statu, COR);
	dest.x=bigW-350;
	dest.y=5;

		textexto = SDL_CreateTextureFromSurface(window_renderer, texto);


         TTF_SizeText(bigfont, statu, &w, &h);
                    dest.w = w;
                    dest.h = h;
	SDL_RenderCopy(window_renderer, textexto, NULL, &dest);

	SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
	texto = NULL;

	sprintf(statu, "(%d,%d)", EGO.x, EGO.y);

	texto = TTF_RenderUTF8_Solid (font, statu, COR);
	dest.x=bigW-400;
	dest.y=12;

		textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

         TTF_SizeText(font, statu, &w, &h);
                    dest.w = w;
                    dest.h = h;
	SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


	SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
	texto = NULL;

	sprintf(statu, "\tT2gu ( %d ) of %d / %d DAY=%ld", mana, K, N_CARTOLA, dayO );

	texto = TTF_RenderUTF8_Solid (bigfont, statu, CORv);
	dest.x=350;
	dest.y=25;

		textexto = SDL_CreateTextureFromSurface(window_renderer, texto);


         TTF_SizeText(bigfont, statu, &w, &h);
                    dest.w = w;
                    dest.h = h;
	SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


	SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
	texto = NULL;


	sprintf(statu, "Tempo: %ld", Tempo);
	if (Tempo > 60) {tempo_min=Tempo/60; tempo_seg=Tempo%60; sprintf(statu, "Tempo: %dm %ds", tempo_min, tempo_seg);}
	if (Tempo > 3600) { tempo_hora = Tempo/3600;tempo_min%=60;sprintf(statu, " %dh %dm %ds", tempo_hora, tempo_min, tempo_seg); }

	texto = TTF_RenderUTF8_Solid (bigfont, statu, CORv);
	dest.x=bigW-150;
	dest.y=175+(SCREEN_HEIGHT-(SCREEN_HEIGHT/2));

		textexto = SDL_CreateTextureFromSurface(window_renderer, texto);



         TTF_SizeText(bigfont, statu, &w, &h);
                    dest.w = w;
                    dest.h = h;
	SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


	SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
	texto = NULL;

	sprintf(statu, "Lux: %d", Lux);
	texto = TTF_RenderUTF8_Solid (bigfont, statu, CORv);
	dest.x=bigW-150;
	dest.y=195+(SCREEN_HEIGHT-(SCREEN_HEIGHT/2));

		textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

         TTF_SizeText(bigfont, statu, &w, &h);
                    dest.w = w;
                    dest.h = h;
	SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


	SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
	texto = NULL;


// and now. .
// hp bar player
    for (i=0; i<=((float)(EGO.hp)/(float)(EGO.hpmax))*50; i++ ) {
		src.x = 0; src.y=100; src.w=10; src.h = 5;
		dest.x = 25; dest.y=2*i+55;
dest.w = src.w; dest.h = src.h;

		SDL_RenderCopy(window_renderer, texture[6], &src, &dest);


        }
// mana bar

        texto = TTF_RenderUTF8_Solid (bigfont, "Mana", CORv);
        dest.x=5;
        dest.y=(SCREEN_HEIGHT-245);
        dest.w = src.w; dest.h = src.h;
		textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

         TTF_SizeText(bigfont, "Mana", &w, &h);
                    dest.w = w;
                    dest.h = h;
        SDL_RenderCopy(window_renderer, textexto, NULL, &dest);

	SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
	texto = NULL;

    for (i=0; i<=TempoGauge/3; i++ ) {
		src.x = 0; src.y=0; src.w=15; src.h = 5;
		dest.x = 25; dest.y=i*3+(SCREEN_HEIGHT-225);
            SDL_RenderCopy(window_renderer, texture[6], &src, &dest);

        }

        //// SELECTED ENTITY ?
	  if ( PALLANTIR > 0 && PALLANTIR <N_CARTOLA ) // entity portrait,
                                                // when clicked LEFT mouse
       {
        sprintf(statu, "%s - HP(%d/%d)", cartola[PALLANTIR].id, cartola[PALLANTIR].hp, cartola[PALLANTIR].hpmax);
        texto=TTF_RenderUTF8_Solid(bigfont, statu, COR);

        	textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

		dest.x = SCREEN_WIDTH-300;
		dest.y = SCREEN_HEIGHT-200;

         TTF_SizeText(bigfont, statu, &w, &h);
        dest.w = w;
        dest.h = h;
		SDL_RenderCopy(window_renderer, textexto, NULL, &dest);

		SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
		texto = NULL;
/////////////// portrait, NPC or item
            src.y = 0; src.x = 50*cartola[PALLANTIR].tipo; src.w=50; src.h=50;
                dest.x = SCREEN_WIDTH-280;
                dest.y = SCREEN_HEIGHT-190;
                dest.w = 200; dest.h = 200;

            if ( cartola[PALLANTIR].tipo < 60 ) { // NPC

                SDL_SetTextureAlphaMod(texture[3],200);
				SDL_RenderCopy(window_renderer, texture[3], &src, &dest);

				}
            else { // ITEM
                    src.x = 50*(cartola[PALLANTIR].tipo-60);
                        SDL_SetTextureAlphaMod(texture[5], 200);
                        SDL_RenderCopy(window_renderer, texture[5], &src, &dest);
                }
///////////////////////////////////

    } else if ( PALLANTIR < 0 ) { // selected party member

                sprintf(statu, "%s - HP(%d/%d)", Livro[party[abs(PALLANTIR)].tipo].nome, party[abs(PALLANTIR)].hp, Livro[party[abs(PALLANTIR)].tipo].hp);
        texto=TTF_RenderUTF8_Solid(bigfont, statu, COR);

	textexto = SDL_CreateTextureFromSurface(window_renderer, texto);

		dest.x = SCREEN_WIDTH-300;
		dest.y = SCREEN_HEIGHT-200;

         TTF_SizeText(bigfont, statu, &w, &h);
        dest.w = w;
        dest.h = h;
		SDL_RenderCopy(window_renderer, textexto, NULL, &dest);


		SDL_FreeSurface(texto); SDL_DestroyTexture(textexto); textexto = NULL;
		texto = NULL;
// party portrait
            src.y = 0; src.x = 50*party[abs(PALLANTIR)].tipo; src.w=50; src.h=50;
                dest.x = SCREEN_WIDTH-280;
                dest.y = SCREEN_HEIGHT-190;
                dest.w = 200; dest.h = 200;

                 SDL_SetTextureAlphaMod(texture[3], 200);
				SDL_RenderCopy(window_renderer, texture[3], &src, &dest);

			}

} // Desenha_stats()

void Input_Teclado ()
{   char **selectoptions; unsigned char k; char msg[300];
    double BBx, BBy;
    int buffy=0;

	while (SDL_PollEvent(&Evento))   //Poll our SDL key event for any keystrokes.
	{

    if ( !LOCKEY )
		switch(Evento.type){

            case SDL_MOUSEMOTION:
                if ( Evento.motion.x < 1 && pxsc > 0 )
                    { pxsc-=STEP; DUDEx-=STEP; }
                if ( Evento.motion.x >= SCREEN_WIDTH-1 && pxsc < size_mapa-1 )
                    { pxsc+=STEP; DUDEx+=STEP; }
                if ( Evento.motion.y < 1 && pysc > 0 )
                    { pysc-=STEP; DUDEy-=STEP; }
                if ( Evento.motion.y >= SCREEN_HEIGHT-1 && pysc < size_mapa-1 )
                    { pysc+=STEP; DUDEy+=STEP; }
            break;

            case SDL_MOUSEWHEEL:
                if(Evento.wheel.y > 0) // zoom up
                {
                    Digue("+ + pseudoZOOM IN + +");
						if ( QTO  < 45 )  { QTO++;
                                            ALOHA = (SCREEN_HEIGHT)/(QTO);

                        } else Digue("max noyozoom reached!");
                }
                else if(Evento.wheel.y < 0) // zoom down
                {
                    Digue("- - pseudoZOOM OUT - -");
						  if ( QTO  > 21 ) { QTO--;
                                            ALOHA = (SCREEN_HEIGHT)/(QTO);

                        } else Digue("min noyozoom reached!");
                }

            break;

            case SDL_MOUSEBUTTONDOWN:


    BBx = (((Evento.button.x)/QTO))+(pxsc)+1;
    BBy = (((Evento.button.y)/QTO))+(pysc)-1;

        if ( BBx < 1 ) BBx = 1;
        if ( BBx > size_mapa-2 ) BBx = size_mapa-2;
        if ( BBy < 1 ) BBy = 1;
        if ( BBy > size_mapa-2 ) BBy = size_mapa-2;

    Desenha (0, 0, BBx-(pxsc), BBy-(pysc), 0, texture[5]); // red square


if (Evento.button.button == SDL_BUTTON_LEFT )



    if ( BBx > 1 && BBx <size_mapa-2 \
        && BBy > 1 && BBy < size_mapa-2 ) {

            PALLANTIRy = BBy;
            PALLANTIRx = BBx;

    }
if (Evento.button.button == SDL_BUTTON_MIDDLE )

            { // deselect by clicking middle button

                PALLANTIRy = 0; PALLANTIRx = 0;
                if ( PALLANTIR > 0 )
                    cartola[PALLANTIR].select = 0;
                if ( PALLANTIR < 0 )
                    party[abs(PALLANTIR)].select = 0;
                PALLANTIR = 0;

                sprintf(msg,"%f,%f",BBx,BBy);
                Digue(msg);
            }


if (Evento.button.button == SDL_BUTTON_RIGHT  ) {


    if ( PALLANTIR )    // if something selected
    {
        if ( PALLANTIR < 0 ) {
            if ( BBx > 1 && BBx <size_mapa-2 \
                    && BBy > 1 && BBy < size_mapa-2 )
                        if (  !mapa[(int)(BBy)][(int)(BBx)].obj )
                          { Walk_Party((int)(BBx),(int)(BBy),abs(PALLANTIR)); }
            }
         if ( PALLANTIR > 0 ) {
            if ( !cartola[PALLANTIR].hostile && cartola[PALLANTIR].vivo )
             {   if ( BBx > 1 && BBx <size_mapa-2 \
                    && BBy > 1 && BBy < size_mapa-2 )
                        if (  !mapa[(int)(BBy)][(int)(BBx)].obj )
                            Walk_NPC((int)BBx,(int)BBy,PALLANTIR);
                } else { // deselect

                        PALLANTIRy = 0; PALLANTIRx = 0;
                        if ( PALLANTIR > 0 )
                            cartola[PALLANTIR].select = 0;
                        if ( PALLANTIR < 0 )
                            party[abs(PALLANTIR)].select = 0;
                        PALLANTIR = 0;
                }
            }
    } else {

            // prepare to issue MOVE command

                        if ( EGO.y-BBy > 0 )
                            EGO.sprite = 6;    // face UP
                        if ( EGO.y-BBy < 0 )
                            EGO.sprite = 0;    //face down
                        if ( EGO.x-BBx > 0 )
                            EGO.sprite = 2;    //face LEFT
                        if ( EGO.x-BBx < 0 )
                            EGO.sprite = 4; // face RIGHT

                if ( BBx > 1 && BBx <size_mapa-2 \
                    && BBy > 1 && BBy < size_mapa-2 ) {
                    if (  !mapa[(int)(BBy)][(int)(BBx)].obj ) {
                            DUDEx=EGO.count_x-EGO.pxScr;
                             DUDEy=EGO.count_y-EGO.pyScr;
                    // if not already in MOVE command
                        if ( !movendo ) // accept right button MOVE command
                            Walk ((int)BBx,(int)BBy, BBx, BBy);
                        else { EGO.xvel=0; EGO.yvel=0; movendo = 0; }
                                        // else completely stop, cancel commands
                            //pegado = 0;
                        } else { Digue("ñ pode mover para este local");
                                 Play_Snd("snd/alarm.wav");
                                }
                    }
         }

    }   // BUTTON right


        break;



//int yay;
int T;
		case SDL_KEYDOWN:

            if ( !LOCKEY )
				switch(Evento.key.keysym.sym){

				// ESCAPE exits game
                    case SDLK_ESCAPE:
                        UaI = UiA;
                        Digue("* ACT_N = 0 - shutdown engine request *");
                                selectoptions = malloc(2*sizeof(char *));
                                if (selectoptions == NULL) { printf("Select: erro alocando memória\n"); return; }
                                for (k=0; k<=2-1; k++)
                                { selectoptions[k] = malloc(351*sizeof(char)); if (selectoptions[k] == NULL ) { printf("Select: erro alocando memória\n"); return; } }
                             strcpy(selectoptions[0], "¡continue++");
                             strcpy(selectoptions[1], "!!EXIT()!!!");
                                Select_Opt(2, selectoptions);
                        for (k=0; k<=1;k++)
                            free(selectoptions[k]);
                        free(selectoptions);

                        if ( abs(selected-1) )
                            act_n = 0;
                        else Digue("Boa!<3");

                    break;
                // minor area fireball with higher range
                    case SDLK_b:
                if (tac.mag == 1) {
                            zD = 2;
							//for (int JAHmmit=0; JAHmmit == EGO.nivel; JAHmmit++ )
							//	ether[EGO.y+JAHmmit][EGO.x-JAHmmit].tipo=9;
							//ether[EGO.y][EGO.x].tipo = 10;
							//ether[EGO.y][EGO.x].pxScr = EGO.pxScr; ether[EGO.y][EGO.x].pyScr = EGO.pyScr;
							ether[EGO.y][EGO.x].tipo = 10;
							ether[EGO.y][EGO.x].pxScr = EGO.count_x-(STEP*2); ether[EGO.y][EGO.x].pyScr = EGO.count_y+(STEP*2);

							Play_Snd("snd/magia.wav"); tac.mag = 0; TempoGauge=0; }
                        break;
                // greater area fireball with less range
                    case SDLK_n:
                if (tac.mag == 1) {
                            zD = 3;

                    for (int JAHmmit=0; JAHmmit <= (EGO.nivel/5) && JAHmmit <5; JAHmmit++ )
                        if ( EGO.y-JAHmmit > 1 && EGO.y+JAHmmit < size_mapa && EGO.x-JAHmmit > 1 && EGO.x+JAHmmit < size_mapa )
							{
                                ether[EGO.y][EGO.x-JAHmmit].tipo=6;
                                ether[EGO.y][EGO.x-JAHmmit].pxScr = EGO.count_x-JAHmmit;
                                ether[EGO.y][EGO.x-JAHmmit].pyScr = EGO.count_y+JAHmmit;
                                ether[EGO.y+JAHmmit][EGO.x+JAHmmit].tipo=9;
                                ether[EGO.y+JAHmmit][EGO.x+JAHmmit].pxScr = EGO.count_x+JAHmmit;
                                ether[EGO.y+JAHmmit][EGO.x+JAHmmit].pyScr = EGO.count_y-JAHmmit;
                                ether[EGO.y-JAHmmit][EGO.x+JAHmmit].tipo=6;
                                ether[EGO.y-JAHmmit][EGO.x+JAHmmit].pxScr = EGO.count_x+JAHmmit;
                                ether[EGO.y-JAHmmit][EGO.x+JAHmmit].pyScr = EGO.count_y-JAHmmit; }



							Play_Snd("snd/magia.wav"); tac.mag = 0; TempoGauge=0; }
                        break;

                    // the big CHEETOOS
					case SDLK_1:
                        EGO.xp+=50;
					break;

                // graphical colormap fiddler
					case SDLK_0:
                        if ( spiel <= 240 )
                            spiel += 5;
						break;
                    case SDLK_9:
                        if ( spiel >= 10 )
                            spiel -= 5;
                        break;

                        // issue MOVE PLAYER cmd TO NEXT party[i]
						case SDLK_KP_0:

                            for (T=NTRUPY-1; T>=0; T--)
                                if ( party[T].tipo )
                                    break;

                            if ( UaI < NTRUPY && party[UaI+(T/4)].tipo)
                               { UaI+=T/4; UiA = UaI;
                                 if (!mapa[party[UaI].y][party[UaI].x].obj && party[UaI].tipo )
                                Walk(party[UaI].x,party[UaI].y,party[UaI].pxScr,party[UaI].pyScr); }
                            else
                                        { UaI = 0; UiA = UaI; }
                        break;

                // SCROLL MAP WITH KEYPAD
                        case SDLK_KP_5:
                             DUDEx=EGO.count_x-EGO.x;
                             DUDEy=EGO.count_y-EGO.y;

                        break;
						case SDLK_KP_8:
                             if ( pysc > 0 ) { pysc-=STEP*4; DUDEy-=STEP*4; }
                        break;
                        case SDLK_KP_2:
                            if ( pysc < size_mapa-1 ) { pysc+=STEP*4; DUDEy+=STEP*4; }                        break;
                        case SDLK_KP_4:
                             if ( pxsc > 0 )  { pxsc-=STEP*4; DUDEx-=STEP*4; }
                        break;
                        case SDLK_KP_6:
                            if ( pxsc < size_mapa-1 ) { pxsc+=STEP*4; DUDEx+=STEP*4; }
                        break;
                        case SDLK_KP_7:
                             EGO.sprite = 2;
                        if ( EGO.x-2<size_mapa-3  && EGO.y-2 <size_mapa-3 && UaI >=0 )
                            if (!mapa[EGO.y-2][EGO.x-2].obj )
                            { UaI = -1;
                                Walk(EGO.x-2,EGO.y-2,EGO.x-2,EGO.y-2); }
                        break;

                    // PLAYER MOVEMENT, WITH KEYPAD and ARROWS
                        case SDLK_KP_1:
                             EGO.sprite = 2;
                        if ( EGO.x-2 > 0  && EGO.y+2 > 0 && UaI >=0 )
                            if (!mapa[EGO.y+2][EGO.x-2].obj )
                            { UaI = -1;
                                Walk(EGO.x-2,EGO.y+2,EGO.x-2,EGO.y+2); }
                        break;
                        case SDLK_KP_3:
                            EGO.sprite = 4;
                         if ( EGO.x+2 <size_mapa-3  && EGO.y+2 <size_mapa-3 && UaI >=0 )
                            if (!mapa[EGO.y+2][EGO.x+2].obj )
                            { UaI = -1;
                                Walk(EGO.x+2,EGO.y+2,EGO.x+2,EGO.y+2); }
                        break;
                        case SDLK_KP_9:
                            EGO.sprite = 4;
                        if ( EGO.x+2 > 0  && EGO.y-2 > 0 && UaI >=0 )
                            if (!mapa[EGO.y-2][EGO.x+2].obj )
                            { UaI = -1;
                                Walk(EGO.x+2,EGO.y-2,EGO.x+2,EGO.y-2); }
                        break;
					case SDLK_LEFT:
                        UaI = UiA;
						if (rest != 1) EGO.xvel = -STEP;
						EGO.sprite = 2;
                            DUDEx=EGO.count_x-EGO.pxScr;
                             DUDEy=EGO.count_y-EGO.pyScr;
						break;
					case SDLK_RIGHT:
                        UaI = UiA;
						if (rest != 1) EGO.xvel = STEP;
						EGO.sprite = 4;
                            DUDEx=EGO.count_x-EGO.pxScr;
                             DUDEy=EGO.count_y-EGO.pyScr;
						break;
					case SDLK_UP:
                        UaI = UiA;
						if (rest != 1) EGO.yvel = -STEP;
						EGO.sprite = 6;
                            DUDEx=EGO.count_x-EGO.pxScr;
                             DUDEy=EGO.count_y-EGO.pyScr;
						break;
					case SDLK_DOWN:
                        UaI = UiA;
						if (rest != 1) EGO.yvel = STEP;
						EGO.sprite = 0;
                            DUDEx=EGO.count_x-EGO.pxScr;
                             DUDEy=EGO.count_y-EGO.pyScr;
						break;
                // ATK/ACT
					case SDLK_SPACE:
                        UaI = UiA;
						if (tac.atq == 1) { oldsprite = EGO.sprite; ataca = 1;

                                            Desenha (183,spraite, STEP+EGO.x-(pxsc), STEP+EGO.y-(pysc), yakka*3, texture[2]);
                                            SDL_RenderPresent(window_renderer);

                                        EGO.sprite = 8; tac.atq=0; Play_Snd("snd/erratq.wav"); }
						break;
                    // toggles stats, console display
					case SDLK_TAB:
                       if ( !(StatuS) )
                            { StatuS = 1; radar = 1; }
						else { StatuS = 0; radar = 1; }
						break;
                    // toggles REST command
					case SDLK_r:
                        UaI = UiA;
						rest = 1;
						break;
                    // WATER
                    case SDLK_t:

						if ( rainy ) { Digue("* CHUVA DESATIVADA *");
                                            rainy = 0; }
                                    else  { Digue("* CHUVA ATIVADA *");
                                            rainy = 1; }
					break;
					case SDLK_y:
						Digue("- - < menos água - -");
						if ( abs(pUddles) > 1 && abs(pUddlelings) > 1 ) { pUddles--; pUddlelings--; }
                            else Digue("min. água atingido");
					break;
					case SDLK_u:
						Digue("* * >+++água * * ");
						if ( abs(pUddles) < 36 && abs(pUddlelings) < 36 ) { pUddles++; pUddlelings++; }
                            else Digue("max água atingido!");
					break;
					// ZOOM
					case SDLK_d:
                        Digue("+ + pseudoZOOM IN + +");
						if ( QTO  < 45 )  { QTO++;
                                            ALOHA = (SCREEN_HEIGHT)/(QTO);

                        } else Digue("max noyozoom reached!");
						break;
                    case SDLK_a:
                        Digue("- - pseudoZOOM OUT - -");
						  if ( QTO  > 21 ) { QTO--;
                                            ALOHA = (SCREEN_HEIGHT)/(QTO);

                        } else Digue("min noyozoom reached!");
                        break;
                    //SAVEGAME
					case SDLK_s:
						SaveGame();
						Digue("Jogo salvo.");
						break;
                    // LOADGAME
					case SDLK_l:
                        UaI = 0;
						LoadGame();
                            Digue("Jogo carregado.");
						break;
                    // INVENTORY
					case SDLK_i:
                        UaI = UiA;
						Mochila(usa);
						break;
                    // toggles EGO, experimental
                    case SDLK_x:
                        if ( party[0].tipo ) {
                            Digue_Window("Leader change");

                            buffy = (float) party[0].tipo;
                                party[0].tipo = EGO.tipo;
                                EGO.tipo = buffy;

                            buffy = (float) party[0].x;
                                    party[0].x = EGO.x-1;
                                    //EGO.x = buffy;
                            buffy = (float) party[0].y;
                                    party[0].y = EGO.y-1;
                                    //EGO.y = buffy;
                            buffy = (float) party[0].pxScr;
                                    party[0].pxScr = EGO.count_x-1;
                                    //EGO.pxScr = buffy; EGO.count_x = buffy;
                            buffy = (float) party[0].pyScr;
                                    party[0].pyScr = EGO.count_y-1;
                                    //EGO.pyScr = buffy; EGO.count_y = buffy;
                            buffy = (float) party[0].hp;
                                    party[0].hp = EGO.hp;
                                    EGO.hp = buffy;
                            buffy = (float) party[0].hpmax;
                                    party[0].hpmax = EGO.hpmax;
                                    EGO.hpmax = buffy;
                            buffy = (float) party[0].nivel;
                                    party[0].nivel = EGO.nivel;
                                    EGO.nivel = buffy;
                            buffy = (float) party[0].xp;
                                    party[0].xp = EGO.xp;
                                    EGO.xp = buffy;
                            party[0].sprite = 0;
                            party[0].walkable = 1;
                            party[0].partykey = 1;
                            party[0].lutando = 0;
                            party[0].vivo = 1;
                            Digue("Novo líder é");
                            Digue(Livro[EGO.tipo].nome);
                            } else Digue("empty party, cannot switch leader");
                        break;
                    // issue MOVE command to player at last spawn point
					case SDLK_h:
                        Digue("- -Egress activated, retreating- -");
						//party[0].hp -= 100;
						if ( !mapa[EGO.iniy][EGO.inix].obj && EGO.inix >= 3 && EGO.iniy >= 3 \
						 && EGO.inix <size_mapa-3 && EGO.iniy <size_mapa-3 && UaI >=0 )
                            Walk(EGO.inix,EGO.iniy,(float)EGO.inix,(float)EGO.iniy);
                        else
                            //{
                            Digue("_ _ _EGRESS *FAIL* _ _ _");
                                //yakka = abs(yekey);  }
						break;
                    // ACTIVATES lameradar
					case SDLK_k:
                        if ( radar )
                            radar = 0;
                        else radar = 1;
						break;
                    // SCROLL party stats UP/DOWN
                        case SDLK_PAGEUP:
                            trupyscry--;
                            if (trupyscry < 1 ) trupyscry = 1;
                        break;
                        case SDLK_PAGEDOWN:
                            trupyscry++;
                            if ( trupyscry > NTRUPY/10) trupyscry = NTRUPY/10;
                        break;

                    // stupid shit
						case SDLK_HOME:
                            /*if ( ZZy>=-1 )
                                ZZy--; */
                            if ( yakka < 5 ) yakka++;
                        break;
                        case SDLK_END:
                            /*if ( ZZy<=1 )
                                ZZy++; */
                            if ( yakka > 1 ) yakka--;
                        break;
                    //////////////////////
					default:
						break;

				}
				break;

        case SDL_KEYUP:

            if ( !LOCKEY )
				switch(Evento.key.keysym.sym){
					case SDLK_LEFT:
						if (EGO.xvel != STEP)
                            EGO.xvel = 0.0;
					break;
					case SDLK_RIGHT:
						if (EGO.xvel != -STEP)
                            EGO.xvel = 0.0;
					break;
					case SDLK_UP:
						if (EGO.yvel != STEP)
                            EGO.yvel = 0.0;
					break;
					case SDLK_DOWN:
						if (EGO.yvel != -STEP)
                            EGO.yvel = 0.0;
					break;
					default:
					break;
                    //UaI = UaI; // (??????)
				}
				break; // */


		case SDL_WINDOWEVENT:
		        switch (Evento.window.event) {
        case SDL_WINDOWEVENT_SHOWN:
            SDL_Log("Window %d shown", Evento.window.windowID);
            break;
        case SDL_WINDOWEVENT_HIDDEN:
            SDL_Log("Window %d hidden", Evento.window.windowID);
            break;
        case SDL_WINDOWEVENT_EXPOSED:
            SDL_Log("Window %d exposed", Evento.window.windowID);
            break;
        case SDL_WINDOWEVENT_MOVED:
            SDL_Log("Window %d moved to %d,%d",
                    Evento.window.windowID, Evento.window.data1,
                    Evento.window.data2);
            break;
        case SDL_WINDOWEVENT_RESIZED:
            tela = SDL_GetWindowSurface( window );
            SDL_Log("Window %d resized to %dx%d",
                    Evento.window.windowID, Evento.window.data1,
                    Evento.window.data2);
		    bigW = Evento.window.data1;
		    bigH = Evento.window.data2;
            break;
        case SDL_WINDOWEVENT_SIZE_CHANGED:
            SDL_Log("Window %d size changed to %dx%d",
                    Evento.window.windowID, Evento.window.data1,
                    Evento.window.data2);
            break;
        case SDL_WINDOWEVENT_MINIMIZED:
            SDL_Log("Window %d minimized", Evento.window.windowID);
            break;
        case SDL_WINDOWEVENT_MAXIMIZED:
            SDL_Log("Window %d maximized", Evento.window.windowID);
            break;
        case SDL_WINDOWEVENT_RESTORED:
            SDL_Log("Window %d restored", Evento.window.windowID);
            break;
        case SDL_WINDOWEVENT_ENTER:
            SDL_Log("Mouse entered window %d",
                    Evento.window.windowID);
            break;
        case SDL_WINDOWEVENT_LEAVE:
            SDL_Log("Mouse left window %d", Evento.window.windowID);
            break;
        case SDL_WINDOWEVENT_FOCUS_GAINED:
            SDL_Log("Window %d gained keyboard focus",
                    Evento.window.windowID);
            break;
        case SDL_WINDOWEVENT_FOCUS_LOST:
            SDL_Log("Window %d lost keyboard focus",
                    Evento.window.windowID);
            break;
        case SDL_WINDOWEVENT_CLOSE:
            SDL_Log("Window %d closed", Evento.window.windowID);
            break;
#if SDL_VERSION_ATLEAST(2, 0, 5)
        case SDL_WINDOWEVENT_TAKE_FOCUS:
            SDL_Log("Window %d is offered a focus", Evento.window.windowID);
            break;
        case SDL_WINDOWEVENT_HIT_TEST:
            SDL_Log("Window %d has a special hit test", Evento.window.windowID);
            break;
#endif
        default:
            SDL_Log("Window %d got unknown event %d",
                    Evento.window.windowID, Evento.window.event);
            break;
          }
	   } // switch Evento

	else    // below inputs do not get locked by Lockey()

        switch(Evento.type) {
                                case SDL_KEYDOWN:

                                    switch(Evento.key.keysym.sym)
                                    {
                                        case SDLK_ESCAPE:

                        UaI = UiA;
                        Digue("* ACT_N = 0 - shutdown engine request *");
                                selectoptions = malloc(2*sizeof(char *));
                                if (selectoptions == NULL) { printf("Select: erro alocando memória\n"); return; }
                                for (k=0; k<=2-1; k++)
                                { selectoptions[k] = malloc(351*sizeof(char)); if (selectoptions[k] == NULL ) { printf("Select: erro alocando memória\n"); return; } }
                             strcpy(selectoptions[0], "¡continue++");
                             strcpy(selectoptions[1], "!!EXIT()!!!");
                                Select_Opt(2, selectoptions);
                        for (k=0; k<=1;k++)
                            free(selectoptions[k]);
                        free(selectoptions);

                        if ( abs(selected-1) )
                            act_n = 0; // with this set, main game loop will quit
                        else Digue("Boa!<3");

                                        break;

                                        default:
                                        // *NOOP* //
                                        break;
                                    }

                                break;

                                default:
                                // *NOOP* //
                                break;

                    }
        /////////////////////////////// end of priority keys


    } // pollEvent while loop

}
