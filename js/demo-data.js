/** Perguntas genéricas só do modo ensaio. Não são as perguntas da família. */
export const DEMO_QUESTIONS = [
    {
        text: 'Em que mês se comemora o Natal?',
        options: ['Janeiro', 'Julho', 'Dezembro', 'Março'],
        correct: 2,
    },
    {
        text: 'Qual é a cor tradicional da roupa do Papai Noel?',
        options: ['Azul', 'Verde', 'Vermelha', 'Amarela'],
        correct: 2,
    },
    {
        text: 'O que se costuma colocar no topo da árvore de Natal?',
        options: ['Uma estrela', 'Um sapato', 'Um livro', 'Um relógio'],
        correct: 0,
    },
    {
        text: 'Na tradição, quais animais puxam o trenó do Papai Noel?',
        options: ['Cavalos', 'Renas', 'Cachorros', 'Gatos'],
        correct: 1,
    },
    {
        text: '"Noite Feliz" é um exemplo de quê?',
        options: ['Receita', 'Jogo de tabuleiro', 'Cantiga de Natal', 'Dança'],
        correct: 2,
    },
];

export function defaultConfig() {
    return {
        totalQuestions: 10,
        currentQuestion: 0,
        currentQuestionKey: null,
        questionOrder: null,
        gameStarted: false,
        gameEnded: false,
        phase: 'lobby',
        timerActive: false,
        timerSeconds: 10,
        timerEndsAt: null,
        answersLocked: false,
        roundId: 0,
    };
}
