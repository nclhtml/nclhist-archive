/*
 * Generated from source-material/peace-table-original.html.
 * Re-run: node scripts/import-peace-table.mjs
 */

import {
  buildDetailedEnding,
  enhanceResponse,
  enhanceScene,
} from "./report.js";

const PEOPLE = {
  koo:{
    name:"Wellington Koo",caption:"Wellington Koo · China",initials:"WK",
    file:"Wellington_Koo_cph.3a44362.jpg",
    url:"https://upload.wikimedia.org/wikipedia/commons/4/40/Wellington_Koo_cph.3a44362.jpg",
    credit:"1916 portrait; photographer unknown. Library of Congress, cph.3a44362."
  },
  lansing:{
    name:"Robert Lansing",caption:"Robert Lansing · United States",initials:"RL",
    file:"Robert_Lansing_cph.3b47713.jpg",
    url:"https://upload.wikimedia.org/wikipedia/commons/0/09/Robert_Lansing_cph.3b47713.jpg",
    credit:"1919 portrait by Harris & Ewing. Library of Congress, cph.3b47713."
  },
  wilson:{
    name:"Woodrow Wilson",caption:"Woodrow Wilson · United States",initials:"WW",
    file:"Thomas Woodrow Wilson, Harris & Ewing bw photo portrait, 1919.jpg",
    credit:"1919 portrait by Harris & Ewing; Library of Congress."
  },
  makino:{
    name:"Makino Nobuaki",caption:"Makino Nobuaki · Japan",initials:"MN",
    file:"Nobuaki Makino.jpg",
    credit:"Portrait listed on Wikimedia Commons; see the source page for details."
  },
  lou:{
    name:"Lou Tseng-tsiang",caption:"Lou Tseng-tsiang · Chinese delegation",initials:"LT",
    file:"Lou Tseng-Tsiang 01.jpg",
    credit:"George Grantham Bain Collection, Library of Congress."
  }
};


const ACTS={
  1:"Act I · Sympathy and support",
  2:"Act II · The price of agreement",
  3:"Act III · The final decision"
};
const DEFAULT_LOCATIONS={
  study:"Grand Hotel · Chinese delegation",
  hall:"Paris · Outside the conference rooms",
  chamber:"Paris · The negotiating table",
  memory:"The Western Front · A memory"
};
const DECISION_NAMES=[
  "The American approach","Japan’s demands",
  "Preparing your last move","The final recommendation"
];

const BRIEF_PARAGRAPHS=[
  "You are Wellington Koo, a member of China’s delegation.",
  "Seek the return of the leased territory of Jiaozhou and Germany’s former railway, mining and other rights in Shandong.",
  "Protect China’s sovereignty, the people’s interests and China’s freedom to make its own decisions.",
  "You will advise the delegation. You cannot command the other powers."
];



const GLOSSARY=[
  {
    id:"sovereignty",term:"Sovereignty",zh:"主權",
    aliases:["sovereignty"],
    meaning:"A country’s right to govern itself and its territory, rather than being ruled by another country."
  },
  {
    id:"territorial",term:"Territorial integrity",zh:"領土完整",
    aliases:["territorial integrity"],
    meaning:"The principle that a country’s territory should remain whole and should not be taken or divided by another power."
  },
  {
    id:"control",term:"Effective control",zh:"實際管治",
    aliases:["effective control","real control"],
    meaning:"Actually being able to govern a place and run its important services. A promise of Chinese sovereignty is not the same as Chinese officials actually being in control."
  },
  {
    id:"delegation",term:"Delegation",zh:"代表團",
    aliases:["delegation","delegations"],
    meaning:"A group sent to speak and negotiate for a country. Koo is one member of China’s delegation, not its only decision-maker."
  },
  {
    id:"leased",term:"Leased territory",zh:"租借地",
    aliases:["leased territory"],
    meaning:"Territory placed under another country’s administration for a period under an agreement. Jiaozhou was Chinese territory leased to Germany; Japan took it from Germany in 1914."
  },
  {
    id:"jiaozhou",term:"Jiaozhou",zh:"膠州",
    aliases:["Jiaozhou","Kiaochow"],
    meaning:"The bay area in Shandong associated with Germany’s leased territory. It included Qingdao. Older English sources may call it Kiaochow."
  },
  {
    id:"qingdao",term:"Qingdao",zh:"青島",
    aliases:["Qingdao","Tsingtao"],
    meaning:"An important port in Shandong. Japan captured the German-held port in 1914. Older English sources may call it Tsingtao."
  },
  {
    id:"league",term:"League of Nations",zh:"國際聯盟",
    aliases:["League of Nations","the League","League’s"],
    meaning:"The international organisation planned after the First World War to help countries settle disputes and prevent war. Wilson made its creation a major goal."
  },
  {
    id:"credibility",term:"Credibility",zh:"公信力",
    aliases:["credibility"],
    meaning:"Being trusted or believed. Here, it means whether countries would trust the League’s promise to protect them."
  },
  {
    id:"allied",term:"Allied side",zh:"協約國陣營",
    aliases:["Allied side","Allied participant","Allies"],
    meaning:"The countries fighting Germany and its partners in the First World War. China declared war on Germany in 1917."
  },
  {
    id:"labourers",term:"Labourers",zh:"勞工",
    aliases:["labourers"],
    meaning:"Workers doing physical jobs. Chinese labourers supported the war effort by moving supplies, repairing roads and doing other essential work."
  },
  {
    id:"claims",term:"Claim",zh:"主張；要求",
    aliases:["claims","claim"],
    meaning:"A statement that a country is entitled to something. A country making a claim does not mean that the claim is accepted or justified."
  },
  {
    id:"privileges",term:"Exclusive privileges",zh:"專有特權",
    aliases:["exclusive privileges","special privileges","privileges"],
    meaning:"Special rights or advantages. Exclusive privileges would give Japan advantages that other countries did not have, such as control over particular railways or mines."
  },
  {
    id:"equal",term:"Equal access",zh:"平等准入",
    aliases:["equal access","equal-access","equal trade","equal terms"],
    meaning:"Allowing countries to trade under the same rules, rather than giving one country special rights. It does not mean allowing foreign countries to govern Chinese territory."
  },
  {
    id:"commercial",term:"Commercial",zh:"商業的",
    aliases:["commercial"],
    meaning:"Connected with trade, business, buying or selling."
  },
  {
    id:"assets",term:"Railway assets",zh:"鐵路資產",
    aliases:["railway assets","assets","railway property"],
    meaning:"Property connected with a railway, such as tracks, stations and equipment. Discussing payment for this property is different from paying for a country’s sovereignty."
  },
  {
    id:"administration",term:"Administration",zh:"行政管理",
    aliases:["administration"],
    meaning:"The officials and system that govern a place or manage its services."
  },
  {
    id:"withdrawal",term:"Troop withdrawal",zh:"撤軍",
    aliases:["troop withdrawal","withdrawal","withdrawn","withdraw"],
    meaning:"Removing soldiers from a place. A promise to withdraw still leaves questions about when it will happen and who will check it."
  },
  {
    id:"deadline",term:"Deadline",zh:"限期",
    aliases:["deadline","fixed date"],
    meaning:"The latest agreed date for completing an action, such as removing troops."
  },
  {
    id:"enforceable",term:"Enforceable timetable",zh:"可強制執行的時間表",
    aliases:["enforceable timetable","enforceable"],
    meaning:"A timetable backed by agreed ways to make the parties keep it or respond if they do not. A written date alone does not guarantee action."
  },
  {
    id:"verification",term:"Independent verification",zh:"獨立核查",
    aliases:["independent verification","verification"],
    meaning:"Checks by inspectors accepted by both sides, rather than relying only on one country’s word."
  },
  {
    id:"safeguards",term:"Safeguards",zh:"保障條件",
    aliases:["safeguards","safeguard"],
    meaning:"Conditions intended to protect against harm or broken promises. Here they include Chinese control, a withdrawal deadline and checks on what happens."
  },
  {
    id:"reservation",term:"Formal reservation",zh:"正式保留",
    aliases:["formal reservation","reservation"],
    meaning:"Here, a request to sign the treaty without accepting its Shandong clauses. For this route at the conference, China needs the other powers to accept that arrangement."
  },
  {
    id:"clauses",term:"Shandong clauses",zh:"山東條款",
    aliases:["Shandong clauses","Shandong provisions","clauses","provisions"],
    meaning:"The parts of the treaty dealing with Germany’s former rights in Shandong. They transfer those rights to Japan, not the whole province."
  },
  {
    id:"protest",term:"Separate protest",zh:"另行提出抗議",
    aliases:["separate protest"],
    meaning:"A statement saying that China objects. Sending this statement does not by itself remove the Shandong clauses from a treaty China signs."
  },
  {
    id:"exemption",term:"Exemption",zh:"豁免",
    aliases:["exemption","exception"],
    meaning:"An agreed arrangement that a rule or requirement does not apply in a particular case. China cannot obtain one just by asking for it."
  },
  {
    id:"coercion",term:"Coercion",zh:"脅迫",
    aliases:["coercion","coerced"],
    meaning:"Making someone agree by using force or threats. China argued that Japan had used threats to obtain the 1915 agreements."
  },
  {
    id:"concessions",term:"Concessions",zh:"讓步",
    aliases:["concessions","concession"],
    meaning:"Something a country agrees to give up or allow during negotiations. A proposal to discuss a concession is not yet an agreement to grant it."
  },
  {
    id:"commitment",term:"Commitment",zh:"承諾",
    aliases:["commitments","commitment"],
    meaning:"A promise to take a particular action. Sympathy or willingness to listen is not the same as a firm commitment to help."
  },
  {
    id:"binding",term:"Binding",zh:"有約束力的",
    aliases:["binding"],
    meaning:"Creating an obligation that a party is expected or legally required to follow. A suggestion alone is not binding."
  },
  {
    id:"conditional",term:"Conditional",zh:"有條件的",
    aliases:["conditional","conditions","condition"],
    meaning:"Depending on stated requirements being met. If China’s proposal is conditional, its offer does not take effect unless those requirements are accepted."
  },
  {
    id:"compromise",term:"Compromise",zh:"折衷協議",
    aliases:["compromise"],
    meaning:"An agreement in which the sides accept less than everything they wanted. There is no compromise until the sides actually agree."
  },
  {
    id:"settlement",term:"Settlement",zh:"解決方案；協議",
    aliases:["settlement","settling"],
    meaning:"An arrangement intended to settle a dispute or end a conflict. At Paris, the wider peace settlement covered many issues besides Shandong."
  },
  {
    id:"restoration",term:"Restoration",zh:"歸還；恢復",
    aliases:["restoration","restore","restored"],
    meaning:"Returning something to its previous holder or position. Here, it means returning the territory or disputed rights to Chinese control."
  },
  {
    id:"revision",term:"Revision",zh:"修訂",
    aliases:["revision"],
    meaning:"Changing an existing document or agreement. Hoping for revision later does not mean anyone has agreed to make that change."
  },
  {
    id:"diplomacy",term:"Diplomacy",zh:"外交",
    aliases:["diplomacy","diplomatic"],
    meaning:"Managing relations between countries through discussion, negotiation and other peaceful methods."
  },
  {
    id:"treaty",term:"Treaty",zh:"條約",
    aliases:["Treaty of Versailles","treaty"],
    meaning:"A formal agreement between countries. The Treaty of Versailles set the peace terms with Germany after the First World War."
  },
  {
    id:"powers",term:"The powers",zh:"列強",
    aliases:["other powers","the powers","great powers"],
    meaning:"Here, the powerful countries with the greatest influence over the peace settlement. China could present its case but could not order them to agree."
  },
  {
    id:"telegram",term:"Telegram",zh:"電報",
    aliases:["telegram"],
    meaning:"A written message sent quickly over a telegraph network. Delegates used telegrams to receive news and instructions from home."
  },
  {
    id:"livelihoods",term:"Livelihoods",zh:"生計",
    aliases:["livelihoods"],
    meaning:"The jobs and income that people depend on to live."
  },
  {
    id:"sympathy",term:"Sympathy",zh:"同情",
    aliases:["sympathy","sympathise"],
    meaning:"Understanding or feeling concern for another person’s or country’s difficulties. It does not necessarily lead to practical help."
  },
  {
    id:"security",term:"Security",zh:"安全",
    aliases:["security"],
    meaning:"Protection against danger or threats. A country may seek military, political or economic arrangements to protect itself."
  }
];


function commercialRoute(a) {
  return a[1]==="commerce" || a[1]==="assets";
}

function optionsFor(number,a) {
  if (number===1) return [
    {
      id:"principle",label:"Protect the League’s credibility",
      text:"“Ask Wilson to defend China’s sovereignty. If the League accepts unfair treatment of China, why should other countries trust it to protect them?”"
    },
    {
      id:"separate",label:"Settle Shandong separately",
      text:"“Ask Wilson to keep the Shandong dispute separate from the wider peace settlement. China supports peace, but Japan’s claims should not decide whether the League is created.”"
    },
    {
      id:"access",label:"Offer equal trade, not foreign control",
      text:"“America wants equal access to trade. Ask Wilson to support Chinese control and trade open to all countries, instead of exclusive privileges for Japan.”"
    }
  ];
  if (number===2) return [
    {
      id:"challenge",label:"Challenge Japan’s claim",
      text:"“China challenges agreements obtained through coercion. Return our rights directly. We will not offer payment or new privileges for recognising China’s sovereignty.”"
    },
    {
      id:"commerce",label:"Propose equal access to trade",
      text:"“Japan could trade under the same Chinese laws as other countries. Chinese administration must return and foreign troops must withdraw. Japan would receive no exclusive privileges over railways or mines.”"
    },
    {
      id:"assets",label:"Discuss railway property only",
      text:"“China could discuss paying for railway assets after their value is checked. We would not pay for sovereignty. Japan must agree to return control and withdraw its troops by a fixed date.”"
    }
  ];
  if (number===3) return [
    {
      id:"reservation",label:"Prepare a formal reservation",
      text:"Prepare a request to sign the treaty without accepting its Shandong clauses. Ask the other powers to agree before China promises to sign.",
      locked:false
    },
    {
      id:"safeguards",label:"Test your earlier offer",
      text:"Put your earlier offer into writing. Require Chinese administration, a troop withdrawal deadline and independent verification. No concessions take effect unless these safeguards are agreed.",
      locked:!commercialRoute(a),
      reason:"Not available: you did not make an economic offer in Decision 2. There is no earlier offer ready to develop."
    },
    {
      id:"public",label:"Explain China’s case publicly",
      text:"Prepare a joint statement from the Chinese delegation. Explain the coercion behind Japan’s claims and the risks to Chinese control. Seek public support without offering new concessions.",
      locked:false
    }
  ];
  const conditional=a[2]==="reservation" ? {
    id:"conditional",label:"Submit your formal reservation",
    text:"Recommend signing only if the other powers accept the formal reservation. If they refuse, China will not sign.",
    locked:false
  } : a[2]==="safeguards" ? {
    id:"conditional",label:"Continue talks without signing",
    text:"Recommend not signing this treaty. Keep your earlier offer open for further talks, but only with its written safeguards. No concessions take effect without agreement.",
    locked:false
  } : {
    id:"conditional",label:"Accept an agreed compromise",
    text:"Japan has not agreed to a different settlement. Publishing China’s objections did not produce a compromise to accept.",
    locked:true,
    reason:"Not available: no compromise has been agreed, and you did not prepare a conditional route."
  };
  return [
    {
      id:"refuse",label:"Refuse the unchanged treaty",
      text:"Recommend that China refuse to sign. Explain China’s objection and continue seeking the return of the rights through diplomacy. Refusal alone will not force Japan to leave."
    },
    {
      id:"sign",label:"Sign and send a separate protest",
      text:"Recommend signing the treaty and sending a separate protest. Hope to change the Shandong clauses in later talks, although no country has promised to change them."
    },
    conditional
  ];
}
function optionFor(number,id,a=[]) {
  return optionsFor(number,a).find(option => option.id===id);
}

function baseResponseFor(number,a) {
  if (number===1) return {
    principle:{
      who:"lansing",emotion:"serious",
      text:"“I will put that argument to Wilson. It challenges the League’s credibility. But he still fears that Japan will refuse to join. I cannot promise that he will oppose Japan’s demands.”",
      record:"Lansing agrees to present China’s argument. He gives no promise that Wilson will oppose Japan."
    },
    separate:{
      who:"lansing",emotion:"nod",
      text:"“I will ask him to consider separate talks. That might protect the wider settlement. But Britain and France have promised support for Japan’s claims. They may refuse to separate the issues.”",
      record:"Lansing agrees to raise separate talks. The other powers do not agree to remove Shandong from the wider settlement."
    },
    access:{
      who:"lansing",emotion:"nod",
      text:"“Equal access interests America. I will put your idea before our delegation. But Japan wants special privileges, not just permission to trade. America has not promised to force it to accept equal terms.”",
      record:"The Americans consider equal access. They give no promise to make Japan accept it."
    }
  }[a[0]];

  if (number===2) return {
    challenge:{
      who:"makino",emotion:"firm",
      text:"“Japan will not give up what it gained through victory and agreements. China’s war against Germany does not cancel its agreements with Japan. We insist that Germany’s former rights pass to us.”",
      record:"Japan refuses direct restoration. China offers no payment or new privileges."
    },
    commerce:{
      who:"makino",emotion:"firm",
      text:"“Ordinary trade is not enough. Japan expects Germany’s railway and mining privileges. We may discuss returning the leased territory later. First, the conference must recognise our claims.”",
      record:"Japan rejects equal access and continues demanding special privileges. No agreement is reached."
    },
    assets:{
      who:"makino",emotion:"firm",
      text:"“This is not only about money. The railway gives Japan influence as well as income. We will not give up that position simply because China offers a checked price on its own conditions.”",
      record:"Japan rejects payment on China’s conditions. No purchase or restoration is agreed."
    }
  }[a[1]];

  if (number===3) {
    if (a[2]==="reservation") return {
      who:"lansing",emotion:"serious",
      text:a[0]==="separate"
        ? "“Your earlier request for separate talks has helped us prepare this formal reservation. It is ready. But the other powers have not accepted it. They fear that other delegations will also ask for exceptions.”"
        : "“The formal reservation is ready. But this new request still needs the other powers’ agreement. They fear that other delegations will also ask to leave parts of the treaty out.”",
      record:a[0]==="separate"
        ? "China’s earlier request becomes a written formal reservation. The other powers have not accepted it."
        : "A formal reservation is prepared. The other powers have not accepted it."
    };
    if (a[2]==="safeguards") return {
      who:"makino",emotion:"serious",
      text:"“We know that people abroad are watching. Japan can discuss restoration later. But we will not accept your withdrawal deadline or independent verification before our rights are recognised.”",
      record:"Japan refuses the deadline and independent verification. China’s conditional offer does not take effect."
    };
    return {
      who:"lou",emotion:"nod",
      text:"“Our statement is ready for publication. People outside the conference will be able to read China’s case. But public attention is not a promise of help from another government.”",
      record:"The delegation publishes its statement. No foreign government makes a new promise to change the settlement."
    };
  }

  if (a[3]==="sign") return {
    who:"lou",emotion:"serious",
    text:"“The delegation accepts your recommendation. China signs and sends a separate protest. The Shandong clauses are still in the treaty. No change has been promised.”",
    record:"China signs and sends a separate protest. No exemption or later revision is agreed."
  };
  if (a[3]==="refuse") return {
    who:"lou",emotion:"nod",
    text:"“Then China will not sign. We will state our objection clearly. The other powers have not changed the treaty, and Japan has not agreed to withdraw.”",
    record:"China does not sign. The treaty is unchanged, and no Japanese withdrawal is agreed."
  };
  if (a[2]==="reservation") return {
    who:"lansing",emotion:"serious",
    text:"“The powers have refused the formal reservation. They will not let China sign on that basis.” His reply lies before you. Your condition has not been met. The delegation does not sign.",
    record:"The powers reject the formal reservation. Following its stated condition, China does not sign."
  };
  return {
    who:"lou",emotion:"serious",
    text:"“We will not sign. Our conditional offer can remain open for further talks. Japan has not accepted its safeguards, so none of the proposed concessions takes effect.”",
    record:"China does not sign. Its conditional offer remains open, but Japan accepts none of its safeguards."
  };
}

function baseEndingFor(a) {
  const facts=[
    a[3]==="sign"
      ? "China signed the treaty and sent a separate protest."
      : "China did not sign the treaty.",
    "The other powers did not change the Shandong clauses.",
    "No agreement requiring Japan to withdraw by a fixed date was reached."
  ];
  if (a[2]==="public") facts.push("The Chinese delegation published its joint statement.");
  if (a[3]==="conditional" && a[2]==="reservation") {
    facts.push("The powers rejected China’s formal reservation.");
  }
  if (a[3]==="conditional" && a[2]==="safeguards") {
    facts.push("China kept its conditional offer open. No proposed concessions took effect.");
  }

  if (a[3]==="sign") return {
    key:"signed",
    title:"A signature on the page",
    narrative:"The pen moves across the paper. Lou gathers the signed document and China’s protest. Outside, a messenger waits to carry the news home.",
    facts,
    question:"Did signing produce an agreed change, or only a chance to seek change later?"
  };
  if (a[3]==="conditional" && a[2]==="safeguards") return {
    key:"talks",
    title:"The talks are not over",
    narrative:"The treaty remains unsigned. You place your written conditions in a separate folder. Lou closes it carefully: “We will need these if talks continue.”",
    facts,
    question:"How does keeping an offer open differ from obtaining an agreement?"
  };
  if (a[3]==="conditional") return {
    key:"reservation",
    title:"The condition was refused",
    narrative:"You read the reply again. The requested exception has been refused. Lou places the unsigned treaty beside your formal reservation. Neither of you reaches for the pen.",
    facts,
    question:"What did testing a conditional signature achieve, if it did not change the treaty?"
  };
  return {
    key:a[2]==="public" ? "public-refusal" : "refusal",
    title:a[2]==="public" ? "An unsigned treaty. A public statement." : "The unsigned treaty",
    narrative:"Lou places the unsigned document on the desk. “We have made our decision. Now we must explain it to the people at home.” You look once more at the red circle around Shandong.",
    facts,
    question:"What could refusing to sign protect, and what could it not recover?"
  };
}

function scene(id,act,bg,who,text,extra={}) {
  const person=Boolean(PEOPLE[who]);
  return {
    id,act,bg,who,
    speaker:person ? PEOPLE[who].name : who,
    cast:person ? (who==="koo" ? ["koo"] : [who,"koo"]) : [],
    focus:person ? who : null,
    text,...extra
  };
}

function baseBuildStory(a) {
  const s=[];
  const add=(...nodes) => s.push(...nodes);
  add(
    scene("awake",1,"study","You",
      "You wake suddenly at an unfamiliar desk. Beneath your hand lies a map. Shandong is circled in red. A folded paper beside it carries your name: Wellington Koo."),
    scene("brief",1,"study","Your instructions","",{kind:"note"}),
    scene("workers",1,"memory","Wellington Koo (Your thoughts)",
      "Around 140,000 Chinese labourers supported the British and French war effort. They moved supplies, repaired roads and worked behind the battle lines. Many never returned. China now comes to the peace conference on the Allied side."),
    scene("charge",1,"study","lou",
      "“Japan wants Germany’s former rights in Shandong. We must defend China’s sovereignty and the people who live there. A different foreign flag is not our goal. You will speak, but our delegation must decide together.”",
      {emotion:"serious"}),
    scene("april",1,"hall","Paris · April 1919",
      "Weeks of talks pass. Britain and France have promised support for Japan’s claims. France also wants a peace settlement that protects its security in Europe. Lansing stops beside you in the corridor."),
    scene("america",1,"hall","lansing",
      "“I sympathise with China. But Wilson fears that Japan may refuse to join the League of Nations if its demands are rejected. What should I ask him to do?”",
      {emotion:"serious"})
  );
  function decision(number,act,bg,who,title,context) {
    add(scene("d"+number,act,bg,who,"",{kind:"choice",number,title,context}));
    if (!a[number-1]) return false;
    const selected=optionFor(number,a[number-1],a);
    add(scene("answer"+number,act,bg,"koo",selected.text,{emotion:"firm"}));
    const reply=responseFor(number,a);
    add(scene("response"+number,act,bg,reply.who,reply.text,{emotion:reply.emotion}));
    return true;
  }

  if (!decision(1,1,"hall","lansing",
    "Sympathy is not yet support.",
    "Lansing will carry one main request to Wilson. Which American concern will you address?")) return s;

  add(
    scene("japan",2,"chamber","makino",
      "“Japan defeated Germany at Qingdao. China’s agreements with Japan in 1915 and 1918 support our claim. Germany’s former rights should pass to Japan. We can discuss restoration of the leased territory later, on conditions.”",
      {emotion:"firm"}),
    scene("distinction",2,"chamber","koo",
      "“What conditions? Chinese territory is not a reward for another country. Ports, railways and mines affect our people’s livelihoods. Who will actually control them?”",
      {emotion:"firm"})
  );

  if (!decision(2,2,"chamber","makino",
    "What lies behind Japan’s promise?",
    a[0]==="access"
      ? "You raised equal access with America. Japan wants special privileges. Will you repeat the proposal, offer talks about railway assets, or reject any new offer?"
      : "Japan wants control and special privileges. You can challenge its claim or test a limited economic offer. Japan has agreed to neither.")) return s;

  add(
    scene("closed",2,"hall","Wellington Koo (Your thoughts)",
      a[1]==="challenge"
        ? "I have offered nothing new. Yet Japan still holds the territory and rights it took from Germany. The other powers have not agreed to return them to China."
        : "I offered talks, not consent. Japan wants the advantages but rejects my conditions. Nothing has been agreed. I must not let my proposal be treated as a promise.",
      {cast:["koo"],focus:"koo",quote:"A proposal is not an agreement."}),
    scene("may",2,"study","A telegram from China · May 1919",
      "News of the Shandong decision has reached China. Protests began in Beijing on 4 May. Students and citizens demand that China’s rights be defended. The telegram shakes slightly in your hand."),
    scene("lastmove",2,"study","lou",
      "“The powers still plan to transfer Germany’s former rights to Japan. Time is running short. We can prepare one main final move before the treaty is signed.”",
      {emotion:"serious"})
  );

  if (!decision(3,2,"study","lou",
    "Prepare your last move.",
    "No alternative settlement has been agreed. Choose what the delegation should prepare now. Your earlier decisions affect the available options.")) return s;

  add(
    scene("june",3,"chamber","wilson",
      "“I believe Japan will return the leased territory later. But I cannot obtain the change you ask for in this treaty. I am trying to keep the wider settlement and the League together.”",
      {date:"June 1919",emotion:"serious"}),
    scene("cost",3,"chamber","koo",
      "“A promise about the future does not return control today. China’s rights cannot be the price of Japan’s cooperation.”",
      {emotion:"firm"}),
    scene("finalbrief",3,"study","lou",
      a[2]==="reservation"
        ? "“The treaty is unchanged. Our formal reservation is ready, but the powers have not accepted it. We can submit it and refuse to sign if they reject it. Or we can choose refusal now, or signature with a separate protest.”"
        : a[2]==="safeguards"
          ? "“Japan has refused our deadline and independent verification. There is no compromise to accept. We can refuse, keep conditional talks open without signing, or sign and send a separate protest.”"
          : "“Our public statement has been published. But we have no agreed compromise and no prepared conditional route. We must recommend refusal, or signature with a separate protest.”",
      {date:"June 1919",emotion:"serious"})
  );

  if (!decision(4,3,"study","lou",
    "What will you recommend?",
    "The Shandong clauses still transfer Germany’s former rights to Japan. Choose from the terms actually available to your delegation.")) return s;

  add(
    scene("lastthought",3,"study","Wellington Koo (Your thoughts)",
      a[3]==="sign"
        ? "The sound of the pen is small. The responsibility is not. When I explain this decision at home, I must be honest about what has—and has not—been agreed."
        : "The pen remains on the desk. Beyond this room, the people whose future we defend are waiting. Our decision must be explained to them.",
      {cast:["koo"],focus:"koo",emotion:"serious",quote:"The people at home still wait."}),
    scene("end",3,"hall","Your outcome","",{kind:"end",ending:endingFor(a)})
  );
  return s;
}

const HISTORICAL_SUMMARY=
  "The Treaty of Versailles assigned Germany’s former rights in Shandong to Japan. "+
  "Protests began in Beijing on 4 May 1919. The Chinese delegation did not sign the treaty on 28 June. "+
  "A separate agreement between China and Japan in 1922 provided for return of the leased territory "+
  "and Chinese recovery of the railway through payment arrangements.";


function responseFor(number, answers) {
  return enhanceResponse(
    number,
    answers,
    baseResponseFor(number, answers)
  );
}

function endingFor(answers) {
  return buildDetailedEnding(
    answers,
    baseEndingFor(answers)
  );
}

function buildStory(answers) {
  return baseBuildStory(answers).flatMap(node =>
    enhanceScene(node, answers)
  );
}

export {
  PEOPLE,
  ACTS,
  DEFAULT_LOCATIONS,
  DECISION_NAMES,
  BRIEF_PARAGRAPHS,
  GLOSSARY,
  HISTORICAL_SUMMARY,
  optionsFor,
  optionFor,
  responseFor,
  endingFor,
  buildStory,
};
