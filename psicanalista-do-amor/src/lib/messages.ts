/** Mensagens amigáveis (pt-BR) para códigos de erro e etapas de progresso. */

// Cada mensagem diz o que aconteceu e o que fazer, sem culpar a pessoa nem expor detalhes técnicos.
const AI_RETRY = "Não conseguimos terminar o relatório desta vez. Tente de novo: a conversa já está salva, não precisa enviar outra vez.";
const AI_OUR_SIDE = "Tivemos um problema do nosso lado ao gerar o relatório. Tente de novo em alguns minutos.";

const ERRORS: Record<string, string> = {
  forbidden: "Por segurança, não conseguimos confirmar este envio. Recarregue a página e envie de novo.",
  too_large:
    "O envio passou do tamanho máximo. Exporte a conversa do WhatsApp \"Sem mídia\" e envie o .txt, ou envie menos prints.",
  invalid_form: "Não conseguimos ler o envio. Recarregue a página e tente de novo.",
  invalid_fields: "Confira se o e-mail está escrito certo (por exemplo, nome@exemplo.com) e envie de novo.",
  consent_required: "Para continuar, marque todas as declarações obrigatórias, logo acima do botão.",
  rate_limited: "Muitas tentativas em pouco tempo. Por segurança, espere um pouco (no máximo uma hora) e tente de novo.",
  upload_timeout: "O envio demorou demais e foi interrompido. Confira a sua conexão e tente de novo. Com prints, tente com menos imagens.",
  busy: "Estamos recebendo muitas conversas agora. Tente de novo em alguns minutos.",
  empty_input: "O campo da conversa está vazio. Cole o texto da conversa e envie de novo.",
  text_too_long: "O texto colado passou do limite de 500 mil caracteres. Envie como arquivo .txt.",
  no_files: "Nenhum arquivo foi selecionado. Escolha o arquivo e envie de novo.",
  too_many_files: "Nesta forma de envio vai um arquivo só. Para enviar várias imagens, escolha \"Prints\".",
  too_many_images: "Há prints demais neste envio. Escolha as mais importantes e envie de novo.",
  image_too_large: "Uma das imagens passou do tamanho máximo por print. Corte a imagem ou salve em JPG e envie de novo.",
  unsupported_file_type:
    "Esse tipo de arquivo não é aceito aqui. Confira se a forma de envio escolhida combina com o arquivo (.txt, .zip ou prints em PNG, JPG ou WEBP).",
  invalid_text_file: "O arquivo não parece ser um texto. Envie o .txt da exportação do WhatsApp ou cole a conversa.",
  empty_file: "O arquivo está vazio. Exporte a conversa de novo e envie o arquivo gerado.",
  unrecognized_format:
    "Não reconhecemos o formato da conversa. Envie a exportação do WhatsApp (.txt) ou cole no formato \"Nome: mensagem\", uma por linha.",
  no_messages: "Não encontramos mensagens na conversa enviada. Confira se é a exportação da conversa certa e envie de novo.",
  files_missing: "Os arquivos originais já foram apagados: por segurança, eles ficam guardados só por pouco tempo. Envie a conversa de novo.",
  zip_invalid: "Não conseguimos abrir o .zip. Ele pode estar corrompido ou protegido por senha. Exporte a conversa de novo ou envie o .txt.",
  zip_too_many_entries: "O .zip tem arquivos demais (máximo de 200). Envie só a exportação da conversa ou menos prints.",
  zip_too_large: "O conteúdo do .zip fica grande demais depois de descompactado. Exporte a conversa \"Sem mídia\" e envie o .txt.",
  zip_suspicious: "Por segurança, não aceitamos este .zip. Envie o .txt da conversa ou as prints diretamente.",
  zip_empty: "Não encontramos uma conversa (.txt) nem prints dentro do .zip. Confira o arquivo ou envie o .txt diretamente.",
  image_invalid: "Não conseguimos ler uma das imagens. Confira se todas são prints em PNG, JPG ou WEBP e envie de novo.",
  heic_unsupported: "Não conseguimos abrir fotos em HEIC. Envie as prints em PNG ou JPG (as prints de tela do iPhone já saem em PNG).",
  ocr_failed: "Não conseguimos ler as prints. Tente de novo com imagens mais nítidas, sem cortar o texto dos balões.",
  ocr_empty: "Não encontramos mensagens nas prints. Confira se as imagens mostram os balões da conversa e envie de novo.",
  ai_rate_limited: "Estamos com muita procura agora. Tente de novo em alguns minutos.",
  ai_unavailable: "O serviço que gera o relatório está instável no momento. Tente de novo em alguns minutos.",
  ai_invalid_output: AI_RETRY,
  ai_missing_section: AI_RETRY,
  generation_failed: AI_RETRY,
  ai_auth: AI_OUR_SIDE,
  ai_model_not_found: AI_OUR_SIDE,
  ai_bad_request: AI_OUR_SIDE,
  ai_aborted: AI_OUR_SIDE,
  ingest_failed: "Algo deu errado do nosso lado ao ler a conversa enviada.",
  server_error: "Algo deu errado do nosso lado. Tente de novo em instantes.",
  not_found: "Não encontramos este relatório. Ele pode ter sido excluído: confira em Minhas análises.",
  not_ready: "O relatório ainda está sendo preparado. Espere alguns instantes e tente de novo.",
  unavailable: "O pagamento deste relatório ainda não está disponível. Tente de novo mais tarde.",
  main_required: "Desbloqueie o relatório completo antes de comprar relatórios adicionais.",
  already_subscribed: "Sua assinatura já está ativa.",
  subscription_pending: "Você já tem uma assinatura aberta no Stripe. Confira em Minha conta.",
  subscription_limit: "Você já usou os relatórios completos de hoje pela assinatura. O limite renova à meia-noite (horário de Brasília).",
  subscription_inactive: "Não encontramos uma assinatura ativa neste e-mail. Confira em Minha conta.",
  login_required: "Entre pelo link enviado ao seu e-mail para usar a sua assinatura.",
  overage_not_allowed: "Este valor é só para assinantes que já usaram o limite do dia.",
  needs_user_side: "Para este relatório, precisamos saber qual das duas pessoas é você. Indique isso na página do relatório principal.",
  network: "Falha de conexão. Confira a sua internet e tente de novo.",
};

export function errorMessage(code: string | null | undefined): string {
  return (code && Object.hasOwn(ERRORS, code) ? ERRORS[code] : null) || "Algo deu errado. Tente de novo em instantes.";
}

export function progressLabel(p: { step: string; current?: number; total?: number } | null | undefined): string {
  if (!p) return "Preparando…";
  const of = p.current && p.total ? ` (${p.current} de ${p.total})` : "";
  switch (p.step) {
    case "received":
      return "Recebendo";
    case "reading":
      return "Lendo os arquivos";
    case "unzipping":
      return "Abrindo o .zip";
    case "preparing_images":
      return `Preparando as prints${of}`;
    case "ocr":
      return `Lendo prints${of}`;
    case "organizing":
      return "Organizando mensagens";
    case "ready_to_confirm":
      return "Pronto para confirmar";
    case "queued":
      return "Na fila";
    case "stats":
      return "Calculando estatísticas";
    case "analyzing":
      return `Analisando trecho${of}`;
    case "writing":
      return "Escrevendo o relatório";
    case "done":
      return "Pronto";
    case "failed":
      return "Não conseguimos concluir";
    default:
      return "Processando";
  }
}
