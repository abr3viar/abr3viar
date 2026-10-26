import { describe, expect, it } from "vitest";
import { anticipatesPaidConclusion, isRealAlert, isSafeHook, mentionsName, safeLockedTitle, seriousSafetyConcerns } from "@/server/reports/guards";

const names = ["Ana Júlia", "Lucas"];

describe("proteções do gancho e dos títulos bloqueados", () => {
  it("reconhece nomes sem acento/caixa e como palavra inteira", () => {
    expect(mentionsName("o jeito como LUCAS responde", names)).toBe(true);
    expect(mentionsName("o que ana julia esconde", names)).toBe(true);
    expect(mentionsName("lucasfilm", names)).toBe(false);
  });

  it("título bloqueado: recusa nomes, cópia do título real e sobreposição alta", () => {
    expect(safeLockedTitle("O dia em que algo mudou", "Lucas esfriou em março", names, "F")).toBe("O dia em que algo mudou");
    expect(safeLockedTitle("Lucas esfriou", "Real", names, "F")).toBe("F");
    expect(safeLockedTitle("Esfriou em março", "Lucas esfriou em março", names, "F")).toBe("F");
    expect(safeLockedTitle("", "x", names, "F")).toBe("F");
  });

  it("gancho: precisa citar alguém e não pode ter números/horários", () => {
    expect(isSafeHook("Mas há algo no jeito como Lucas volta depois dos silêncios…", names)).toBe(true);
    expect(isSafeHook("Mas Lucas responde depois das 23h…", names)).toBe(false);
    expect(isSafeHook("Mas há algo que muda tudo…", names)).toBe(false);
    expect(isSafeHook("Mas há algo no jeito como Ana2 responde…", ["Ana2", "Bia"])).toBe(true);
  });

  it("seção grátis que antecipa conclusão paga (IA-5) é detectada; descrição de hábitos não", () => {
    for (const leak of [
      "Tudo indica que Ana está mais investida do que Lucas.",
      "Lucas parece MENOS INTERESSADO nas últimas semanas.",
      "Fica claro quem se importa mais nessa relação.",
      "O momento de virada foi a viagem.",
      "A conversa sugere que Lucas está se afastando.",
      "Do jeito que vai, isso pode terminar logo.",
      "Meu conselho: fale sobre o fim de semana.",
    ]) {
      expect(anticipatesPaidConclusion(leak), leak).toBe(true);
    }
    for (const ok of [
      "Ana manda mais mensagens e Lucas responde em poucos minutos.",
      "Os dois falam muito de séries e do trabalho de Ana.",
      "Lucas usa mais emojis; Ana faz mais perguntas.",
      "Ana pede conselho a Lucas sobre o trabalho.",
    ]) {
      expect(anticipatesPaidConclusion(ok), ok).toBe(false);
    }
  });
});

describe("proteções extras (revisão de segurança)", () => {
  it("título bloqueado com horário/data/porcentagem ou conclusão paga vira o neutro", () => {
    expect(safeLockedTitle("As 23h que mudam tudo", "Real", names, "F")).toBe("F");
    expect(safeLockedTitle("Quem está mais investido", "Real", names, "F")).toBe("F");
    expect(safeLockedTitle("O que ninguém percebeu (5)", "Real", names, "F")).toBe("O que ninguém percebeu (5)");
  });
  it("gancho que antecipa a conclusão paga é recusado", () => {
    expect(isSafeHook("Mas Lucas está se afastando, e isso muda tudo…", names)).toBe(false);
  });
});

describe("nomes completos (revisão)", () => {
  const full = ["Ana Júlia Souza", "Lucas Lima"];
  it("título bloqueado com só o primeiro nome é recusado", () => {
    expect(safeLockedTitle("Lucas está se afastando", "O que mudou em março", full, "F")).toBe("F");
    expect(safeLockedTitle("Ana investe mais", "Quem sustenta a relação", full, "F")).toBe("F");
  });
  it("gancho com o primeiro nome é aceito", () => {
    expect(isSafeHook("Mas há algo no jeito como Lucas volta depois dos silêncios…", full)).toBe(true);
  });
});

describe("alerta e antecipação sem falso positivo (revisão)", () => {
  it("frases comuns não contam como conclusão paga", () => {
    expect(anticipatesPaidConclusion("A conversa pode acabar indo para memes")).toBe(false);
    expect(anticipatesPaidConclusion("Os dois são mais interessados em séries do que em sair")).toBe(false);
    expect(anticipatesPaidConclusion("Lucas parece o mais investido dos dois")).toBe(true);
  });
  it("seção alerta negativa não liga o alerta; risco real liga", () => {
    expect(isRealAlert({ content: "Não há sinais de risco nesta conversa, que segue tranquila e respeitosa." })).toBe(false);
    expect(isRealAlert({ content: "Há uma ameaça explícita no trecho #31 que merece atenção e cuidado imediato." })).toBe(true);
  });
  it("notas do map: brincadeira isolada não dispara; ameaça ou 2+ sinais disparam", () => {
    // (3ª revisão: ameaça de morte "com riso" também liga — falso positivo custa só o gancho.)
    expect(seriousSafetyConcerns(["#12 — 'vou te matar kkk' em tom de piada"])).toBe(true);
    expect(seriousSafetyConcerns([])).toBe(false);
    expect(seriousSafetyConcerns(["#40 — ameaça de expor fotos"])).toBe(true);
    expect(seriousSafetyConcerns(["#5 — controle do horário", "#9 — pede a senha do celular"])).toBe(true);
    expect(seriousSafetyConcerns(["", "  "])).toBe(false);
  });
});

describe("sinais graves nunca ficam sem alerta (revisão de segurança)", () => {
  it("cada categoria grave sozinha liga o alerta pelas notas do map", () => {
    for (const c of [
      "#10 — quer morrer e que ninguém sentiria falta",
      "#11 — não aguenta mais viver",
      "#12 — controla o celular e proíbe ver amigos",
      "#13 — B diz que tem 15 anos",
      "#14 — chantagem com fotos íntimas",
      "#15 — disse 'vou te matar'",
      "#16 — ameaça de morte disfarçada de brincadeira",
      "#17 — empurrou e deu um tapa",
    ]) {
      expect(seriousSafetyConcerns([c]), c).toBe(true);
    }
  });
  it("seção alerta com termo grave conta mesmo com negação no meio do texto", () => {
    expect(isRealAlert({ content: "B controla o celular de A. Mesmo sem sinais de violência física, isso é controle e merece atenção." })).toBe(true);
    expect(isRealAlert({ content: "A diz que pensa em se machucar. Procure ajuda sem demora se houver risco imediato." })).toBe(true);
    expect(isRealAlert({ content: "Não há sinais de risco nesta conversa; o tom é leve e respeitoso o tempo todo." })).toBe(false);
  });
});

describe("3ª revisão: qualquer sinal registrado liga o alerta", () => {
  it("categorias sem palavra-chave da lista também ligam", () => {
    for (const c of [
      "#20 — fala em tirar a própria vida",
      "#21 — quer desaparecer e acabar com tudo",
      "#22 — vai tomar todos os remédios",
      "#23 — pressiona para transar mesmo ela dizendo não",
      "#24 — vai espalhar as fotos dela",
      "#25 — B é de menor",
      "#26 — está no oitavo ano da escola",
      "#27 — promete dar um murro nela",
      "#28 — chutou a porta e quebrou o celular dela",
      "#29 — exige a localização dela o tempo todo",
    ]) {
      expect(seriousSafetyConcerns([c]), c).toBe(true);
    }
  });
  it("autolesão/ameaça com riso continua ligando", () => {
    expect(seriousSafetyConcerns(["#30 — diz 'quero morrer kkk' depois da briga"])).toBe(true);
    expect(seriousSafetyConcerns(["#31 — diz que vai se matar, rs"])).toBe(true);
  });
  it("alerta que começa com 'Sem…'/'Nenhum…' mas relata risco conta", () => {
    expect(isRealAlert({ content: "Sem querer alarmar: Lucas exige saber onde Ana está o tempo todo e fica furioso quando ela demora." })).toBe(true);
    expect(isRealAlert({ content: "Nenhum dos dois parece seguro: Ana diz que tem medo de voltar para casa por causa dele." })).toBe(true);
  });
});

describe("4ª revisão: nada é descartado como 'brincadeira'", () => {
  it("violência, coerção e controle chamados de piada ligam o alerta", () => {
    for (const c of [
      "deu um tapa nela 'de brincadeira' e ela chorou",
      "chuta e empurra ela, rindo kkk",
      "diz que vai bater nela kkk",
      "insiste em sexo e diz que é só zoeira quando ela recusa",
      "força ela a mandar foto pelada, 'é piada'",
      "vigia o celular dela e diz que é brincadeira",
      "persegue ela na saída da escola haha",
      "mora no RS e controla com quem ela fala",
    ]) {
      expect(seriousSafetyConcerns([c]), c).toBe(true);
    }
  });
  it("negação com ressalva ('porém', 'mas') ou medo/insegurança conta como alerta", () => {
    expect(isRealAlert({ content: "Não há sinais de risco imediato, porém Ana relata ter medo dele e evita voltar para casa." })).toBe(true);
    expect(isRealAlert({ content: "Sem sinais claros de risco, mas ela diz que não se sente segura quando ele bebe." })).toBe(true);
  });
});

describe("5ª revisão: negação seguida de qualquer relato conta", () => {
  it("frase depois da negação faz o alerta contar", () => {
    expect(isRealAlert({ content: "Não há sinais de risco evidentes. Lucas manda Ana apagar as fotos com os amigos e fica bravo quando ela sai." })).toBe(true);
    expect(isRealAlert({ content: "Nenhum sinal de risco físico. Ele diz que se ela terminar, ele some e ela vai se arrepender." })).toBe(true);
    expect(isRealAlert({ content: "Não há sinais de risco nesta conversa, que segue leve e respeitosa do começo ao fim" })).toBe(false);
  });
});
