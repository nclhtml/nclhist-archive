/*
 * Earlier decisions influence the closing conversations.
 * They do not manufacture diplomatic victories.
 *
 * The ending screen keeps the original short format.
 */

const AMERICAN_REVIEW = {
  principle:
    "“You asked us to judge the League by its treatment of China. " +
    "That argument was heard. But Wilson still put keeping Japan " +
    "within the wider settlement first. We did not obtain the change " +
    "you wanted. A hearing was not a promise of support.”",

  separate:
    "“You asked us to separate Shandong from the wider peace. " +
    "The suggestion was considered, but the other powers did not " +
    "agree to separate the issues. Their commitments to Japan " +
    "remained. Changing the procedure was not something China " +
    "could decide alone.”",

  access:
    "“You appealed to America’s interest in equal trade. That did " +
    "give us a reason to listen. But we made no commitment to make " +
    "Japan give up its special privileges. A shared commercial " +
    "interest was not enough to change the settlement.”",
};

function economicReview(answers) {
  const [american, economic, preparation, final] = answers;

  if (economic === "challenge") {
    return (
      "I refused to offer payment or new privileges for recognising " +
      "China’s rights. We gave nothing new away—but Japan did not " +
      "give up its claim either. " +
      (
        american === "access"
          ? "The equal-trade argument I had used with America was not " +
            "an offer I repeated to Japan."
          : "Holding that boundary was within our power. Making Japan " +
            "accept direct restoration was not."
      )
    );
  }

  if (economic === "commerce") {
    let ending;

    if (preparation === "safeguards" && final === "conditional") {
      ending =
        "Our offer remains open, but only with the safeguards Japan " +
        "has not accepted. We have kept a possibility alive, not " +
        "secured an agreement.";
    } else if (preparation === "safeguards") {
      ending =
        "Even putting our requirements into writing did not make " +
        "Japan accept a withdrawal deadline or independent checks.";
    } else {
      ending =
        "The offer did not become an agreement. China’s willingness " +
        "to allow ordinary trade did not grant Japan new privileges.";
    }

    return (
      "I offered Japan ordinary trade under Chinese law, not " +
      "exclusive railway and mining privileges. Japan wanted more " +
      "than access to a market: it wanted a privileged position. " +
      ending
    );
  }

  let ending;

  if (preparation === "safeguards" && final === "conditional") {
    ending =
      "We can discuss that proposal again, but only on its stated " +
      "conditions. No price, transfer of control or withdrawal date " +
      "has been agreed.";
  } else if (preparation === "safeguards") {
    ending =
      "Our written conditions did not overcome that objection. " +
      "No purchase or protected transfer of control was agreed.";
  } else {
    ending =
      "Discussing a checked price was not the same as buying the " +
      "railway. Nothing was purchased, and no control was returned.";
  }

  return (
    "I distinguished railway property from sovereignty. We might " +
    "pay for property, but not for recognition of China’s rights. " +
    "Japan valued the railway’s influence as well as its income. " +
    ending
  );
}

function preparationReview(answers) {
  const [american, , preparation, final] = answers;

  if (preparation === "reservation") {
    const opening = american === "separate"
      ? "“Your earlier request to treat Shandong separately became " +
        "a formal reservation. "
      : "“We prepared a formal reservation to separate our signature " +
        "from acceptance of the Shandong clauses. ";

    if (final === "conditional") {
      return (
        opening +
        "We submitted it, and the powers refused. We then followed " +
        "our stated condition and did not sign. The attempt clarified " +
        "what they would allow, but it did not change the treaty.”"
      );
    }

    if (final === "sign") {
      return (
        opening +
        "But in the end we chose signature with a separate protest, " +
        "not signature conditional on that reservation. The protest " +
        "did not give us the exemption we had prepared to request.”"
      );
    }

    return (
      opening +
      "But we chose refusal without submitting it as our final " +
      "condition. We should not report that the powers rejected a " +
      "final request we chose not to test through that route.”"
    );
  }

  if (preparation === "safeguards") {
    if (final === "conditional") {
      return (
        "“Writing down our safeguards made the boundary clear: " +
        "Chinese administration, a withdrawal deadline and independent " +
        "verification. We have not signed, and the offer remains open. " +
        "But a clear boundary is not an accepted settlement. Japan " +
        "has still not agreed to those requirements.”"
      );
    }

    if (final === "sign") {
      return (
        "“Japan refused our deadline and independent verification. " +
        "We then chose to sign with a separate protest. We must be " +
        "honest about that change: signing did not put our rejected " +
        "safeguards into the treaty. They remained proposals.”"
      );
    }

    return (
      "“Japan would not accept the safeguards we wrote down. We " +
      "therefore refused the unchanged treaty. That protected the " +
      "boundary we had drawn, but it did not return administration " +
      "or remove troops. Those practical questions remain.”"
    );
  }

  if (final === "sign") {
    return (
      "“Our statement put China’s objections before the public. " +
      "It did not bring a new promise of help from another government. " +
      "Now that we have signed, we must explain why—and make clear " +
      "that our separate protest did not remove the clauses we opposed.”"
    );
  }

  return (
    "“Our statement explained China’s case, and our refusal is " +
    "consistent with it. But being heard outside this room did not " +
    "make the other powers change the treaty. We have made our " +
    "objection public; we have not yet recovered the disputed rights.”"
  );
}

function closingScene(id, who, text) {
  const names = {
    lansing: "Robert Lansing",
    koo: "Wellington Koo",
    lou: "Lou Tseng-tsiang",
  };

  return {
    id,
    act: 3,
    bg: "study",
    who,
    speaker: names[who],
    cast: who === "koo" ? ["koo"] : [who, "koo"],
    focus: who,
    emotion: "serious",
    text,
    date: "June 1919",
  };
}

/*
 * Retain the original short ending title, narrative, facts and question.
 */
export function buildDetailedEnding(answers, base) {
  return {
    ...base,
    disclaimer:
      "Historical simulation: conversations are dramatised, not " +
      "verbatim historical quotations.",
  };
}

/*
 * Keep immediate responses short, including in the worksheet.
 * Additional explanation appears in the closing conversation.
 */
export function enhanceResponse(number, answers, base) {
  return base;
}

export function enhanceScene(node, answers) {
  if (node.id !== "lastthought" || answers.length !== 4) {
    return node;
  }

  return [
    closingScene(
      "closing-america",
      "lansing",
      AMERICAN_REVIEW[answers[0]]
    ),

    closingScene(
      "closing-economic",
      "koo",
      economicReview(answers)
    ),

    closingScene(
      "closing-preparation",
      "lou",
      preparationReview(answers)
    ),

    node,
  ];
}