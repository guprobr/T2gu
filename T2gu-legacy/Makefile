##
# Makefile para t4c.c
# Autor: Gustavo Loureiro Conte
##

CC = gcc $(CFLAGS) 
LD = $(CC) 
LIBS = `sdl2-config --libs` -L/usr/lib -lSDL2_image -lSDL2_ttf -lSDL2_image -lSDL2_mixer -lm

EXEC = T2gu 

all: $(EXEC)

.PHONY: all clean

##### kernel/script/graphz
T2gu: T2gu.c
	$(LD) $(LFLAGS) $< -o $@

clean:
	rm -rf $(EXEC) cartola savegame
$(EXEC): $(OBJECTS)
	$(CC) $(LDFLAGS) $^ $(LIBS) -o $@


