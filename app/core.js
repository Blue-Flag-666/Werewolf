export class core {
    static CAMP = {
        COMMONER: 0, GOOD: 1, WEREWOLF: 2, THIRD: 3
    };
    static commoner = 4;
    static goodCamp = new Map([["预言家", 1], ["女巫", 1], ["猎人", 1], ["守卫", 0], ["白痴", 1], ["骑士", 0],])
    static werewolf = new Map([["狼人", 4], ["狼王", 0], ["白狼王", 0],])
    static thirdCamp = new Map([["丘比特", 0]])
}

class Character {
    constructor(name, number) {
        this.name = name;
        this.number = number;
    }

    setNumber(number) {
        this.number = number;
    }
}

class Player {
    constructor(id, character) {
        this.id = id;
        this.character = character;
    }
}

class Game {
    constructor() {
        this.characters = new Map();
    }

}