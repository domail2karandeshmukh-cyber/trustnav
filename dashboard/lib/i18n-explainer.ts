/**
 * The narrated explainer, in ten languages. Each scene has one caption that is
 * also spoken. Placeholders: {name} the platform's name, {trust} its score,
 * {gap} the size of the refused lie. Keep sentences short: they are read aloud.
 */

export type Lang = "en" | "fr" | "de" | "es" | "it" | "pt" | "hi" | "mr" | "te" | "ta";
export type SceneId = "welcome" | "trusted" | "colours" | "attack" | "checks" | "alerts" | "respond" | "pages" | "end";
export const SCENES: SceneId[] = ["welcome", "trusted", "colours", "attack", "checks", "alerts", "respond", "pages", "end"];

export interface Pack {
  name: string;          // the language, in itself
  code: string;          // BCP 47 for speech
  fallbackCode?: string; // voice to borrow when the device has none for this language
  ui: { title: string; language: string; pause: string; resume: string; next: string; prev: string; close: string; noVoice: string; start: string; scene: string };
  noAttack: string;      // spoken instead of "attack" when no platform is under attack right now
  s: Record<SceneId, string>;
}

export const LANGS: Record<Lang, Pack> = {
  en: {
    name: "English", code: "en-GB",
    ui: { title: "Explainer", language: "Language", pause: "Pause", resume: "Resume", next: "Next", prev: "Back", close: "Close", noVoice: "No voice for this language on this device; captions only.", start: "Narrated explainer, 3 minutes", scene: "Scene" },
    noAttack: "No attack is running right now. In a moment one van will be spoofed; let us look at the other panels first.",
    s: {
      welcome: "Welcome to TrustNav. Seven vehicles are driving around Angers. Every second, TrustNav checks whether each one's satellite position can be believed, and gives it a score from 0 to 100.",
      trusted: "This is {name}. Its ring is green: its score is {trust}. It moves like a van, stays on its route, and the satellite signals look genuine.",
      colours: "The colours are simple. Green: trusted, 75 or more. Amber: minor doubts. Orange: suspicious. Pink: untrusted, under 25. The dashed blue line is the route the vehicle is supposed to follow.",
      attack: "Now look at {name}. A spoofer is feeding its receiver a fake signal. The hollow marker is where the receiver claims to be. The teal shield is where the van really is. The dashed line between them is the lie: {gap}.",
      checks: "How does TrustNav know? Three checks. Is it possible? A van cannot jump 8 kilometres in one second. Is it normal? It has learned what normal driving looks like. Is it signed? Galileo satellites sign their messages, and a fake message fails the check.",
      alerts: "Every attack opens an alert here: which vehicle, since when, how low the score fell, and what action was taken.",
      respond: "TrustNav does not only warn. It refuses the fake position and tracks the van by its odometer, which the attacker cannot touch. The operator gets a short checklist: what to do now.",
      pages: "Replay plays ten recorded attacks with a narrated story. Results has the numbers: 99.3 percent precision, 0.44 percent false alarms. Method explains how it decides.",
      end: "GPS is trusted blindly. TrustNav is the guard that checks. Press P for the presentation, or the question mark for the guide. Thank you.",
    },
  },
  fr: {
    name: "Français", code: "fr-FR",
    ui: { title: "Explication", language: "Langue", pause: "Pause", resume: "Reprendre", next: "Suivant", prev: "Retour", close: "Fermer", noVoice: "Pas de voix pour cette langue sur cet appareil ; sous-titres seulement.", start: "Explication commentée, 3 minutes", scene: "Scène" },
    noAttack: "Aucune attaque n'est en cours pour l'instant. Dans un instant, une camionnette sera leurrée ; regardons d'abord les autres panneaux.",
    s: {
      welcome: "Bienvenue sur TrustNav. Sept véhicules circulent dans Angers. Chaque seconde, TrustNav vérifie si la position satellite de chacun peut être crue, et lui donne une note de 0 à 100.",
      trusted: "Voici {name}. Son anneau est vert : sa note est {trust}. Il se déplace comme une camionnette, reste sur son itinéraire, et les signaux satellites semblent authentiques.",
      colours: "Les couleurs sont simples. Vert : fiable, 75 ou plus. Ambre : doutes mineurs. Orange : suspect. Rose : non fiable, moins de 25. La ligne bleue en pointillés est l'itinéraire que le véhicule doit suivre.",
      attack: "Regardez maintenant {name}. Un leurre envoie un faux signal à son récepteur. Le marqueur creux est l'endroit où le récepteur prétend être. Le bouclier turquoise est l'endroit où la camionnette se trouve vraiment. La ligne en pointillés entre les deux est le mensonge : {gap}.",
      checks: "Comment TrustNav le sait-il ? Trois vérifications. Est-ce possible ? Une camionnette ne peut pas sauter de 8 kilomètres en une seconde. Est-ce normal ? Il a appris à quoi ressemble une conduite normale. Est-ce signé ? Les satellites Galileo signent leurs messages, et un faux message échoue au contrôle.",
      alerts: "Chaque attaque ouvre une alerte ici : quel véhicule, depuis quand, jusqu'où la note est tombée, et quelle action a été prise.",
      respond: "TrustNav ne se contente pas d'avertir. Il refuse la fausse position et suit la camionnette grâce à son odomètre, que l'attaquant ne peut pas toucher. L'opérateur reçoit une courte liste : que faire maintenant.",
      pages: "Replay rejoue dix attaques enregistrées avec une histoire racontée. Results donne les chiffres : 99,3 pour cent de précision, 0,44 pour cent de fausses alertes. Method explique comment il décide.",
      end: "On fait aveuglément confiance au GPS. TrustNav est le gardien qui vérifie. Appuyez sur P pour la présentation, ou sur le point d'interrogation pour le guide. Merci.",
    },
  },
  de: {
    name: "Deutsch", code: "de-DE",
    ui: { title: "Erklärung", language: "Sprache", pause: "Pause", resume: "Weiter", next: "Vor", prev: "Zurück", close: "Schließen", noVoice: "Keine Stimme für diese Sprache auf diesem Gerät; nur Untertitel.", start: "Gesprochene Erklärung, 3 Minuten", scene: "Szene" },
    noAttack: "Gerade läuft kein Angriff. Gleich wird ein Lieferwagen getäuscht; sehen wir uns zuerst die anderen Felder an.",
    s: {
      welcome: "Willkommen bei TrustNav. Sieben Fahrzeuge fahren durch Angers. Jede Sekunde prüft TrustNav, ob die Satellitenposition jedes Fahrzeugs geglaubt werden kann, und vergibt eine Punktzahl von 0 bis 100.",
      trusted: "Das ist {name}. Sein Ring ist grün: seine Punktzahl ist {trust}. Es bewegt sich wie ein Lieferwagen, bleibt auf seiner Route, und die Satellitensignale sehen echt aus.",
      colours: "Die Farben sind einfach. Grün: vertrauenswürdig, 75 oder mehr. Bernstein: kleine Zweifel. Orange: verdächtig. Pink: nicht vertrauenswürdig, unter 25. Die gestrichelte blaue Linie ist die Route, der das Fahrzeug folgen soll.",
      attack: "Sehen Sie jetzt {name}. Ein Spoofer speist ein gefälschtes Signal in seinen Empfänger. Der hohle Marker ist die Position, die der Empfänger behauptet. Das türkise Schild ist dort, wo der Lieferwagen wirklich ist. Die gestrichelte Linie dazwischen ist die Lüge: {gap}.",
      checks: "Woher weiß TrustNav das? Drei Prüfungen. Ist es möglich? Ein Lieferwagen kann nicht in einer Sekunde 8 Kilometer springen. Ist es normal? Es hat gelernt, wie normales Fahren aussieht. Ist es signiert? Galileo-Satelliten signieren ihre Nachrichten, und eine gefälschte Nachricht fällt bei der Prüfung durch.",
      alerts: "Jeder Angriff öffnet hier eine Warnung: welches Fahrzeug, seit wann, wie tief die Punktzahl gefallen ist und welche Maßnahme ergriffen wurde.",
      respond: "TrustNav warnt nicht nur. Es verweigert die falsche Position und verfolgt den Lieferwagen über seinen Kilometerzähler, den der Angreifer nicht anrühren kann. Der Betreiber bekommt eine kurze Checkliste: was jetzt zu tun ist.",
      pages: "Replay spielt zehn aufgezeichnete Angriffe mit einer erzählten Geschichte ab. Results zeigt die Zahlen: 99,3 Prozent Präzision, 0,44 Prozent Fehlalarme. Method erklärt, wie entschieden wird.",
      end: "GPS wird blind vertraut. TrustNav ist der Wächter, der prüft. Drücken Sie P für die Präsentation oder das Fragezeichen für den Leitfaden. Vielen Dank.",
    },
  },
  es: {
    name: "Español", code: "es-ES",
    ui: { title: "Explicación", language: "Idioma", pause: "Pausa", resume: "Continuar", next: "Siguiente", prev: "Atrás", close: "Cerrar", noVoice: "No hay voz para este idioma en este dispositivo; solo subtítulos.", start: "Explicación narrada, 3 minutos", scene: "Escena" },
    noAttack: "Ahora mismo no hay ningún ataque. En un momento una furgoneta será suplantada; veamos primero los otros paneles.",
    s: {
      welcome: "Bienvenido a TrustNav. Siete vehículos circulan por Angers. Cada segundo, TrustNav comprueba si la posición por satélite de cada uno es creíble y le da una puntuación de 0 a 100.",
      trusted: "Esta es {name}. Su anillo es verde: su puntuación es {trust}. Se mueve como una furgoneta, sigue su ruta y las señales de satélite parecen auténticas.",
      colours: "Los colores son sencillos. Verde: fiable, 75 o más. Ámbar: dudas menores. Naranja: sospechoso. Rosa: no fiable, menos de 25. La línea azul discontinua es la ruta que el vehículo debe seguir.",
      attack: "Ahora mire {name}. Un suplantador envía una señal falsa a su receptor. El marcador hueco es donde el receptor dice estar. El escudo turquesa es donde está realmente la furgoneta. La línea discontinua entre ambos es la mentira: {gap}.",
      checks: "¿Cómo lo sabe TrustNav? Tres comprobaciones. ¿Es posible? Una furgoneta no puede saltar 8 kilómetros en un segundo. ¿Es normal? Ha aprendido cómo es una conducción normal. ¿Está firmado? Los satélites Galileo firman sus mensajes, y un mensaje falso no pasa la comprobación.",
      alerts: "Cada ataque abre una alerta aquí: qué vehículo, desde cuándo, hasta dónde cayó la puntuación y qué acción se tomó.",
      respond: "TrustNav no solo avisa. Rechaza la posición falsa y sigue la furgoneta con su odómetro, que el atacante no puede tocar. El operador recibe una lista corta: qué hacer ahora.",
      pages: "Replay reproduce diez ataques grabados con una historia narrada. Results tiene las cifras: 99,3 por ciento de precisión, 0,44 por ciento de falsas alarmas. Method explica cómo decide.",
      end: "Se confía ciegamente en el GPS. TrustNav es el guardián que comprueba. Pulse P para la presentación, o el signo de interrogación para la guía. Gracias.",
    },
  },
  it: {
    name: "Italiano", code: "it-IT",
    ui: { title: "Spiegazione", language: "Lingua", pause: "Pausa", resume: "Riprendi", next: "Avanti", prev: "Indietro", close: "Chiudi", noVoice: "Nessuna voce per questa lingua su questo dispositivo; solo sottotitoli.", start: "Spiegazione narrata, 3 minuti", scene: "Scena" },
    noAttack: "In questo momento non c'è nessun attacco. Tra poco un furgone verrà ingannato; guardiamo prima gli altri pannelli.",
    s: {
      welcome: "Benvenuti in TrustNav. Sette veicoli circolano ad Angers. Ogni secondo, TrustNav verifica se la posizione satellitare di ciascuno è credibile e le assegna un punteggio da 0 a 100.",
      trusted: "Questo è {name}. Il suo anello è verde: il punteggio è {trust}. Si muove come un furgone, resta sul suo percorso e i segnali satellitari sembrano autentici.",
      colours: "I colori sono semplici. Verde: affidabile, 75 o più. Ambra: piccoli dubbi. Arancione: sospetto. Rosa: non affidabile, sotto 25. La linea blu tratteggiata è il percorso che il veicolo deve seguire.",
      attack: "Ora guardate {name}. Uno spoofer invia un segnale falso al suo ricevitore. Il marcatore vuoto è dove il ricevitore dichiara di essere. Lo scudo turchese è dove si trova davvero il furgone. La linea tratteggiata tra i due è la bugia: {gap}.",
      checks: "Come fa TrustNav a saperlo? Tre controlli. È possibile? Un furgone non può saltare di 8 chilometri in un secondo. È normale? Ha imparato com'è una guida normale. È firmato? I satelliti Galileo firmano i loro messaggi, e un messaggio falso non supera il controllo.",
      alerts: "Ogni attacco apre qui un avviso: quale veicolo, da quando, fin dove è sceso il punteggio e quale azione è stata presa.",
      respond: "TrustNav non si limita ad avvisare. Rifiuta la posizione falsa e segue il furgone con il suo odometro, che l'attaccante non può toccare. L'operatore riceve una breve lista: cosa fare adesso.",
      pages: "Replay riproduce dieci attacchi registrati con una storia narrata. Results contiene i numeri: 99,3 per cento di precisione, 0,44 per cento di falsi allarmi. Method spiega come decide.",
      end: "Ci si fida ciecamente del GPS. TrustNav è la guardia che controlla. Premete P per la presentazione, o il punto interrogativo per la guida. Grazie.",
    },
  },
  pt: {
    name: "Português", code: "pt-PT",
    ui: { title: "Explicação", language: "Idioma", pause: "Pausa", resume: "Continuar", next: "Seguinte", prev: "Anterior", close: "Fechar", noVoice: "Não há voz para este idioma neste dispositivo; apenas legendas.", start: "Explicação narrada, 3 minutos", scene: "Cena" },
    noAttack: "Neste momento não há nenhum ataque. Daqui a pouco uma carrinha será enganada; vejamos primeiro os outros painéis.",
    s: {
      welcome: "Bem-vindo ao TrustNav. Sete veículos circulam por Angers. A cada segundo, o TrustNav verifica se a posição por satélite de cada um é credível e dá-lhe uma pontuação de 0 a 100.",
      trusted: "Esta é {name}. O seu anel é verde: a pontuação é {trust}. Move-se como uma carrinha, mantém-se na sua rota e os sinais de satélite parecem genuínos.",
      colours: "As cores são simples. Verde: fiável, 75 ou mais. Âmbar: pequenas dúvidas. Laranja: suspeito. Rosa: não fiável, abaixo de 25. A linha azul tracejada é a rota que o veículo deve seguir.",
      attack: "Agora veja {name}. Um spoofer está a enviar um sinal falso ao seu recetor. O marcador vazio é onde o recetor diz estar. O escudo turquesa é onde a carrinha realmente está. A linha tracejada entre os dois é a mentira: {gap}.",
      checks: "Como é que o TrustNav sabe? Três verificações. É possível? Uma carrinha não pode saltar 8 quilómetros num segundo. É normal? Aprendeu como é uma condução normal. Está assinado? Os satélites Galileo assinam as suas mensagens, e uma mensagem falsa falha na verificação.",
      alerts: "Cada ataque abre aqui um alerta: que veículo, desde quando, até onde caiu a pontuação e que ação foi tomada.",
      respond: "O TrustNav não se limita a avisar. Recusa a posição falsa e segue a carrinha pelo seu odómetro, que o atacante não pode tocar. O operador recebe uma lista curta: o que fazer agora.",
      pages: "Replay reproduz dez ataques gravados com uma história narrada. Results tem os números: 99,3 por cento de precisão, 0,44 por cento de falsos alarmes. Method explica como decide.",
      end: "Confia-se cegamente no GPS. O TrustNav é o guarda que verifica. Prima P para a apresentação, ou o ponto de interrogação para o guia. Obrigado.",
    },
  },
  hi: {
    name: "हिन्दी", code: "hi-IN",
    ui: { title: "समझाइश", language: "भाषा", pause: "रोकें", resume: "जारी रखें", next: "आगे", prev: "पीछे", close: "बंद करें", noVoice: "इस डिवाइस पर इस भाषा की आवाज़ नहीं है; सिर्फ़ सबटाइटल।", start: "आवाज़ के साथ समझाइश, 3 मिनट", scene: "दृश्य" },
    noAttack: "अभी कोई हमला नहीं चल रहा है। थोड़ी देर में एक वैन पर हमला होगा; पहले बाकी पैनल देखते हैं।",
    s: {
      welcome: "TrustNav में आपका स्वागत है। सात गाड़ियाँ Angers में चल रही हैं। हर सेकंड, TrustNav जाँचता है कि हर गाड़ी की सैटेलाइट पोज़िशन पर भरोसा किया जा सकता है या नहीं, और उसे 0 से 100 तक स्कोर देता है।",
      trusted: "यह है {name}। इसका रिंग हरा है: इसका स्कोर {trust} है। यह एक वैन की तरह चलती है, अपने रास्ते पर रहती है, और सैटेलाइट सिग्नल असली लगते हैं।",
      colours: "रंग आसान हैं। हरा: भरोसेमंद, 75 या ज़्यादा। पीला: छोटे संदेह। नारंगी: संदिग्ध। गुलाबी: भरोसेमंद नहीं, 25 से कम। नीली बिंदीदार रेखा वह रास्ता है जिस पर गाड़ी को चलना चाहिए।",
      attack: "अब देखिए {name}। एक धोखेबाज़ इसके रिसीवर को नकली सिग्नल भेज रहा है। खाली मार्कर वह जगह है जहाँ रिसीवर होने का दावा करता है। फ़िरोज़ी ढाल वह जगह है जहाँ वैन सच में है। दोनों के बीच की बिंदीदार रेखा झूठ है: {gap}।",
      checks: "TrustNav को कैसे पता चलता है? तीन जाँच। क्या यह मुमकिन है? एक वैन एक सेकंड में 8 किलोमीटर नहीं कूद सकती। क्या यह सामान्य है? इसने सीखा है कि सामान्य ड्राइविंग कैसी दिखती है। क्या इस पर हस्ताक्षर हैं? Galileo सैटेलाइट अपने संदेशों पर हस्ताक्षर करते हैं, और नकली संदेश जाँच में फेल हो जाता है।",
      alerts: "हर हमला यहाँ एक अलर्ट खोलता है: कौन सी गाड़ी, कब से, स्कोर कितना गिरा, और क्या कार्रवाई की गई।",
      respond: "TrustNav सिर्फ़ चेतावनी नहीं देता। यह नकली पोज़िशन को अस्वीकार करता है और वैन को उसके ओडोमीटर से ट्रैक करता है, जिसे हमलावर छू नहीं सकता। ऑपरेटर को एक छोटी सूची मिलती है: अब क्या करना है।",
      pages: "Replay दस रिकॉर्ड किए गए हमलों को कहानी के साथ चलाता है। Results में आँकड़े हैं: 99.3 प्रतिशत सटीकता, 0.44 प्रतिशत झूठे अलार्म। Method बताता है कि यह फ़ैसला कैसे करता है।",
      end: "GPS पर आँख बंद करके भरोसा किया जाता है। TrustNav वह पहरेदार है जो जाँचता है। प्रेज़ेंटेशन के लिए P दबाएँ, या गाइड के लिए प्रश्नचिह्न। धन्यवाद।",
    },
  },
  mr: {
    name: "मराठी", code: "mr-IN", fallbackCode: "hi-IN",
    ui: { title: "समजावणी", language: "भाषा", pause: "थांबवा", resume: "पुढे चालू", next: "पुढे", prev: "मागे", close: "बंद करा", noVoice: "या डिव्हाइसवर या भाषेचा आवाज नाही; फक्त सबटायटल.", start: "आवाजासह समजावणी, 3 मिनिटे", scene: "दृश्य" },
    noAttack: "सध्या कोणताही हल्ला सुरू नाही. थोड्या वेळात एका व्हॅनवर हल्ला होईल; आधी बाकीचे पॅनेल बघूया.",
    s: {
      welcome: "TrustNav मध्ये आपले स्वागत आहे. सात गाड्या Angers मध्ये फिरत आहेत. दर सेकंदाला TrustNav तपासतो की प्रत्येक गाडीच्या सॅटेलाइट पोझिशनवर विश्वास ठेवता येईल का, आणि तिला 0 ते 100 पर्यंत स्कोअर देतो.",
      trusted: "ही आहे {name}. हिचं रिंग हिरवं आहे: हिचा स्कोअर {trust} आहे. ती व्हॅनसारखी चालते, आपल्या मार्गावर राहते, आणि सॅटेलाइट सिग्नल खरे वाटतात.",
      colours: "रंग सोपे आहेत. हिरवा: विश्वासार्ह, 75 किंवा जास्त. पिवळसर: छोट्या शंका. केशरी: संशयास्पद. गुलाबी: विश्वासार्ह नाही, 25 पेक्षा कमी. निळी तुटक रेषा म्हणजे गाडीने ज्या मार्गाने जायला हवं तो मार्ग.",
      attack: "आता {name} कडे बघा. एक फसवणूक करणारा हिच्या रिसीव्हरला खोटा सिग्नल पाठवत आहे. पोकळ मार्कर म्हणजे रिसीव्हर जिथे असल्याचा दावा करतो ती जागा. निळसर-हिरवी ढाल म्हणजे व्हॅन खरंच जिथे आहे ती जागा. दोघांमधली तुटक रेषा म्हणजे खोटं: {gap}.",
      checks: "TrustNav ला हे कसं कळतं? तीन तपासण्या. हे शक्य आहे का? व्हॅन एका सेकंदात 8 किलोमीटर उडी मारू शकत नाही. हे नॉर्मल आहे का? त्याने नॉर्मल ड्रायव्हिंग कशी दिसते हे शिकलं आहे. यावर सही आहे का? Galileo उपग्रह आपल्या संदेशांवर सही करतात, आणि खोटा संदेश तपासणीत नापास होतो.",
      alerts: "प्रत्येक हल्ला इथे एक अलर्ट उघडतो: कोणती गाडी, कधीपासून, स्कोअर किती खाली गेला, आणि काय कारवाई केली गेली.",
      respond: "TrustNav फक्त इशारा देत नाही. तो खोटी पोझिशन नाकारतो आणि व्हॅनला तिच्या ओडोमीटरने ट्रॅक करतो, ज्याला हल्लेखोर हात लावू शकत नाही. ऑपरेटरला एक छोटी यादी मिळते: आता काय करायचं.",
      pages: "Replay दहा रेकॉर्ड केलेले हल्ले गोष्टीसह दाखवतो. Results मध्ये आकडे आहेत: 99.3 टक्के अचूकता, 0.44 टक्के खोटे अलार्म. Method सांगतो की तो निर्णय कसा घेतो.",
      end: "GPS वर आंधळा विश्वास ठेवला जातो. TrustNav तो तपासणारा पहारेकरी आहे. प्रेझेंटेशनसाठी P दाबा, किंवा गाइडसाठी प्रश्नचिन्ह. धन्यवाद.",
    },
  },
  te: {
    name: "తెలుగు", code: "te-IN",
    ui: { title: "వివరణ", language: "భాష", pause: "ఆపు", resume: "కొనసాగించు", next: "తర్వాత", prev: "వెనుకకు", close: "మూసివేయి", noVoice: "ఈ పరికరంలో ఈ భాషకు వాయిస్ లేదు; క్యాప్షన్లు మాత్రమే.", start: "వాయిస్‌తో వివరణ, 3 నిమిషాలు", scene: "దృశ్యం" },
    noAttack: "ప్రస్తుతం ఏ దాడి జరగడం లేదు. కొద్దిసేపట్లో ఒక వ్యాన్ మోసగించబడుతుంది; ముందుగా ఇతర ప్యానెళ్లను చూద్దాం.",
    s: {
      welcome: "TrustNav కు స్వాగతం. ఏడు వాహనాలు Angers లో తిరుగుతున్నాయి. ప్రతి సెకను, TrustNav ప్రతి వాహనం యొక్క ఉపగ్రహ స్థానాన్ని నమ్మవచ్చో లేదో తనిఖీ చేసి, 0 నుండి 100 వరకు స్కోరు ఇస్తుంది.",
      trusted: "ఇది {name}. దీని రింగ్ ఆకుపచ్చగా ఉంది: దీని స్కోరు {trust}. ఇది వ్యాన్ లాగా కదులుతుంది, తన మార్గంలోనే ఉంటుంది, ఉపగ్రహ సంకేతాలు నిజమైనవిగా కనిపిస్తాయి.",
      colours: "రంగులు సులభం. ఆకుపచ్చ: నమ్మదగినది, 75 లేదా ఎక్కువ. పసుపు-నారింజ: చిన్న సందేహాలు. నారింజ: అనుమానాస్పదం. గులాబీ: నమ్మదగినది కాదు, 25 కంటే తక్కువ. నీలం చుక్కల గీత వాహనం అనుసరించాల్సిన మార్గం.",
      attack: "ఇప్పుడు {name} ను చూడండి. ఒక మోసగాడు దీని రిసీవర్‌కు నకిలీ సంకేతం పంపుతున్నాడు. ఖాళీ మార్కర్ రిసీవర్ ఉన్నట్లు చెబుతున్న చోటు. నీలాకుపచ్చ కవచం వ్యాన్ నిజంగా ఉన్న చోటు. వాటి మధ్య చుక్కల గీత అబద్ధం: {gap}.",
      checks: "TrustNav కు ఎలా తెలుసు? మూడు తనిఖీలు. ఇది సాధ్యమా? వ్యాన్ ఒక సెకనులో 8 కిలోమీటర్లు దూకలేదు. ఇది సాధారణమా? సాధారణ డ్రైవింగ్ ఎలా ఉంటుందో ఇది నేర్చుకుంది. దీనిపై సంతకం ఉందా? Galileo ఉపగ్రహాలు తమ సందేశాలపై సంతకం చేస్తాయి, నకిలీ సందేశం తనిఖీలో విఫలమవుతుంది.",
      alerts: "ప్రతి దాడి ఇక్కడ ఒక హెచ్చరికను తెరుస్తుంది: ఏ వాహనం, ఎప్పటి నుండి, స్కోరు ఎంత పడిపోయింది, ఏ చర్య తీసుకున్నారు.",
      respond: "TrustNav హెచ్చరించడమే కాదు. నకిలీ స్థానాన్ని తిరస్కరించి, దాడి చేసేవాడు తాకలేని ఓడోమీటర్ ద్వారా వ్యాన్‌ను ట్రాక్ చేస్తుంది. ఆపరేటర్‌కు ఒక చిన్న జాబితా వస్తుంది: ఇప్పుడు ఏమి చేయాలి.",
      pages: "Replay పది రికార్డు చేసిన దాడులను కథతో చూపిస్తుంది. Results లో సంఖ్యలు ఉన్నాయి: 99.3 శాతం ఖచ్చితత్వం, 0.44 శాతం తప్పుడు అలారాలు. Method ఇది ఎలా నిర్ణయిస్తుందో వివరిస్తుంది.",
      end: "GPS ను గుడ్డిగా నమ్ముతారు. TrustNav తనిఖీ చేసే కాపలాదారు. ప్రెజెంటేషన్ కోసం P నొక్కండి, లేదా గైడ్ కోసం ప్రశ్నార్థకం. ధన్యవాదాలు.",
    },
  },
  ta: {
    name: "தமிழ்", code: "ta-IN",
    ui: { title: "விளக்கம்", language: "மொழி", pause: "இடைநிறுத்து", resume: "தொடர்", next: "அடுத்து", prev: "பின்", close: "மூடு", noVoice: "இந்தச் சாதனத்தில் இந்த மொழிக்குக் குரல் இல்லை; வசனங்கள் மட்டும்.", start: "குரலுடன் விளக்கம், 3 நிமிடங்கள்", scene: "காட்சி" },
    noAttack: "இப்போது எந்தத் தாக்குதலும் நடக்கவில்லை. சிறிது நேரத்தில் ஒரு வேன் ஏமாற்றப்படும்; முதலில் மற்ற பலகங்களைப் பார்ப்போம்.",
    s: {
      welcome: "TrustNav க்கு வரவேற்கிறோம். ஏழு வாகனங்கள் Angers இல் ஓடுகின்றன. ஒவ்வொரு வினாடியும், TrustNav ஒவ்வொரு வாகனத்தின் செயற்கைக்கோள் நிலையை நம்பலாமா என்று சரிபார்த்து, 0 முதல் 100 வரை மதிப்பெண் தருகிறது.",
      trusted: "இது {name}. இதன் வளையம் பச்சை: இதன் மதிப்பெண் {trust}. இது ஒரு வேன் போல நகர்கிறது, தன் பாதையில் இருக்கிறது, செயற்கைக்கோள் சமிக்ஞைகள் உண்மையானவையாகத் தெரிகின்றன.",
      colours: "நிறங்கள் எளிமையானவை. பச்சை: நம்பகமானது, 75 அல்லது அதற்கு மேல். மஞ்சள்: சிறு சந்தேகங்கள். ஆரஞ்சு: சந்தேகத்திற்குரியது. இளஞ்சிவப்பு: நம்பகமற்றது, 25 க்குக் கீழ். நீல புள்ளிக்கோடு வாகனம் பின்பற்ற வேண்டிய பாதை.",
      attack: "இப்போது {name} ஐப் பாருங்கள். ஒரு ஏமாற்றுக்காரன் இதன் ரிசீவருக்குப் போலி சமிக்ஞை அனுப்புகிறான். வெற்று குறி ரிசீவர் தான் இருப்பதாகக் கூறும் இடம். நீலப்பச்சை கேடயம் வேன் உண்மையில் இருக்கும் இடம். அவற்றுக்கு இடையே உள்ள புள்ளிக்கோடு பொய்: {gap}.",
      checks: "TrustNav க்கு எப்படித் தெரியும்? மூன்று சோதனைகள். இது சாத்தியமா? ஒரு வேன் ஒரு வினாடியில் 8 கிலோமீட்டர் தாவ முடியாது. இது இயல்பானதா? இயல்பான ஓட்டம் எப்படி இருக்கும் என்று இது கற்றுக்கொண்டது. இதில் கையொப்பம் உள்ளதா? Galileo செயற்கைக்கோள்கள் தங்கள் செய்திகளில் கையொப்பமிடுகின்றன, போலிச் செய்தி சோதனையில் தோல்வியடைகிறது.",
      alerts: "ஒவ்வொரு தாக்குதலும் இங்கே ஒரு எச்சரிக்கையைத் திறக்கிறது: எந்த வாகனம், எப்போதிருந்து, மதிப்பெண் எவ்வளவு குறைந்தது, என்ன நடவடிக்கை எடுக்கப்பட்டது.",
      respond: "TrustNav எச்சரிப்பது மட்டுமல்ல. போலி நிலையை நிராகரித்து, தாக்குபவர் தொட முடியாத ஓடோமீட்டர் மூலம் வேனைக் கண்காணிக்கிறது. ஆபரேட்டருக்கு ஒரு சிறிய பட்டியல் கிடைக்கிறது: இப்போது என்ன செய்வது.",
      pages: "Replay பதிவு செய்யப்பட்ட பத்து தாக்குதல்களைக் கதையுடன் காட்டுகிறது. Results இல் எண்கள் உள்ளன: 99.3 சதவீதம் துல்லியம், 0.44 சதவீதம் தவறான எச்சரிக்கைகள். Method இது எப்படி முடிவு செய்கிறது என்று விளக்குகிறது.",
      end: "GPS கண்மூடித்தனமாக நம்பப்படுகிறது. TrustNav சரிபார்க்கும் காவலன். விளக்கக்காட்சிக்கு P ஐ அழுத்துங்கள், அல்லது வழிகாட்டிக்கு கேள்விக்குறி. நன்றி.",
    },
  },
};

export const LANG_ORDER: Lang[] = ["en", "fr", "de", "es", "it", "pt", "hi", "mr", "te", "ta"];

/** The browser's language, if we have it, else English. */
export function defaultLang(): Lang {
  try {
    const saved = localStorage.getItem("trustnav-lang") as Lang | null;
    if (saved && LANGS[saved]) return saved;
  } catch { /* storage blocked */ }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase().slice(0, 2) as Lang;
  return LANGS[nav] ? nav : "en";
}

export function fill(text: string, vars: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
