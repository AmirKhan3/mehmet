import { readFileSync, writeFileSync } from "fs";

const MAPPING = {
  // Nutrition logging — write to nutrition_entries
  "nutrition_log|append_nutrition_entries_and_recompute": {
    expected_jtbd: "log_nutrition",
    expected_domain: "nutrition",
    expected_tool: "logNutritionItem",
    expected_card_type: "nutrition_item_logged",
    canonical_sources: ["nutrition_entries", "nutrition_targets"],
    source_rules: [
      "Write item to nutrition_entries.",
      "Compute remaining macros at query time from nutrition_entries + nutrition_targets.",
      "LLM estimates macros from training data when no catalog exists.",
    ],
    write_policy: "write",
    grounding_required: true,
  },

  // Workout progress — user reporting what they did
  "workout_progress|acknowledge_progress_and_adjust_guidance": {
    expected_jtbd: "log_workout",
    expected_domain: "workout",
    expected_tool: "logWorkoutEntry",
    expected_card_type: "workout_logged",
    canonical_sources: ["workout_logs", "schedule_templates", "schedule_template_exercises"],
    source_rules: [
      "Write performed exercises to workout_logs.",
      "Match exercises against schedule_templates for the day.",
      "Progress counts are derived from workout_logs at query time.",
    ],
    write_policy: "write",
    grounding_required: true,
  },

  // Workout progress — should I keep going?
  "workout_progress|decide_continue_or_stop_session": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: [
      "LLM answers from conversation context and training data.",
      "No DB grounding required for coaching advice.",
    ],
    write_policy: "read_only",
    grounding_required: false,
  },

  // Image analysis — always coaching, no DB
  "image_analysis_request|analyze_or_compare_images": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: [
      "LLM analyzes images from conversation context.",
      "No DB grounding required.",
    ],
    write_policy: "read_only",
    grounding_required: false,
  },
  "image_analysis_request|analyze_physique": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: [
      "LLM analyzes images from conversation context.",
      "No DB grounding required.",
    ],
    write_policy: "read_only",
    grounding_required: false,
  },

  // Nutrition questions — meal/timing advice is coaching
  "nutrition_question|give_meal_or_timing_advice": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: [
      "LLM answers from training data and conversation context.",
      "May reference nutrition_targets if asking about daily goals.",
    ],
    write_policy: "read_only",
    grounding_required: false,
  },
  "nutrition_question|contextual_nutrition_advice": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: [
      "LLM answers from training data and conversation context.",
      "No DB grounding required for food advice.",
    ],
    write_policy: "read_only",
    grounding_required: false,
  },

  // Nutrition query — reading logged macros from DB
  "nutrition_query|aggregate_logged_macros": {
    expected_jtbd: "view_nutrition",
    expected_domain: "nutrition",
    expected_tool: "getNutritionTargetsVsActuals",
    expected_card_type: "nutrition_targets_vs_actuals",
    canonical_sources: ["nutrition_entries", "nutrition_targets"],
    source_rules: [
      "Itemized truth comes from nutrition_entries.",
      "Targets come from nutrition_targets.",
      "Totals and remaining macros computed at query time.",
    ],
    write_policy: "read_only",
    grounding_required: true,
  },

  // Plan query — macro targets for the day
  "plan_query|return_daily_macro_targets": {
    expected_jtbd: "view_nutrition",
    expected_domain: "nutrition",
    expected_tool: "getNutritionTargetsVsActuals",
    expected_card_type: "nutrition_targets_vs_actuals",
    canonical_sources: ["nutrition_entries", "nutrition_targets"],
    source_rules: [
      "Targets come from nutrition_targets.",
      "If actuals exist, include consumed totals from nutrition_entries.",
    ],
    write_policy: "read_only",
    grounding_required: true,
  },
  "plan_query|return_weekly_macro_targets": {
    expected_jtbd: "view_nutrition",
    expected_domain: "nutrition",
    expected_tool: "getNutritionTargetsVsActuals",
    expected_card_type: "nutrition_targets_vs_actuals",
    canonical_sources: ["nutrition_entries", "nutrition_targets"],
    source_rules: [
      "Targets come from nutrition_targets.",
      "Weekly view aggregates from nutrition_entries.",
    ],
    write_policy: "read_only",
    grounding_required: true,
  },

  // Schedule query — fetching the plan
  "schedule_query|fetch_schedule_template": {
    expected_jtbd: "view_schedule",
    expected_domain: "schedule",
    expected_tool: "getTemplateForWeekday",
    expected_card_type: "weekday_template",
    canonical_sources: ["schedule_templates", "schedule_template_exercises", "schedule_overrides"],
    source_rules: [
      "Schedule comes from schedule_templates and schedule_overrides.",
      "Exercises come from schedule_template_exercises.",
      "Never confuse schedule (planned) with workout_logs (performed).",
    ],
    write_policy: "read_only",
    grounding_required: true,
  },

  // Coaching — customize strategy
  "coaching|customize_strategy": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: [
      "LLM adapts plan based on conversation context and training data.",
      "No DB grounding required.",
    ],
    write_policy: "read_only",
    grounding_required: false,
  },
  "coaching|compare_program_variants": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: [
      "LLM compares options from training data.",
      "No DB grounding required.",
    ],
    write_policy: "read_only",
    grounding_required: false,
  },

  // General questions — coaching, no DB
  "general_question|explain_body_response": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: ["LLM answers from training data."],
    write_policy: "read_only",
    grounding_required: false,
  },
  "general_question|answer_directly_with_context": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: ["LLM answers from training data and conversation context."],
    write_policy: "read_only",
    grounding_required: false,
  },
  "general_question|explain_or_recommend_training_execution": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: ["LLM answers from training data."],
    write_policy: "read_only",
    grounding_required: false,
  },
  "general_question|recommend_progression_milestone": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: ["LLM answers from training data."],
    write_policy: "read_only",
    grounding_required: false,
  },
  "general_question|estimate_hydration_or_activity_impact": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: ["LLM answers from training data."],
    write_policy: "read_only",
    grounding_required: false,
  },
  "general_question|recommend_rest_timing": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: ["LLM answers from training data."],
    write_policy: "read_only",
    grounding_required: false,
  },

  // Status check — interpret what the user is reporting
  "status_check|interpret_status_update": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: [
      "LLM interprets status update from conversation context.",
      "If user asks what they finished, use getWorkoutLogs instead.",
    ],
    write_policy: "read_only",
    grounding_required: false,
  },
  "status_check|interpret_weight_checkin": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: [
      "Weight check-in is coaching context, not a DB write.",
      "May inform athlete_profile.weight if user wants to persist.",
    ],
    write_policy: "read_only",
    grounding_required: false,
  },

  // Program review
  "program_review|review_and_improve_plan": {
    expected_jtbd: "coaching",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: [
      "LLM reviews uploaded plan from conversation context.",
      "No DB grounding required.",
    ],
    write_policy: "read_only",
    grounding_required: false,
  },

  // Formatting request
  "formatting_request|reformat_previous_answer": {
    expected_jtbd: "general",
    expected_domain: "none",
    expected_tool: "none",
    expected_card_type: "none",
    canonical_sources: [],
    source_rules: ["Reformat from conversation context."],
    write_policy: "read_only",
    grounding_required: false,
  },

  // Workout summary query
  "workout_summary_query|identify_exercise_cause": {
    expected_jtbd: "view_workout_logs",
    expected_domain: "workout",
    expected_tool: "getWorkoutLogs",
    expected_card_type: "workout_logs",
    canonical_sources: ["workout_logs"],
    source_rules: [
      "Workout facts come only from workout_logs.",
      "Never use schedule as evidence of completed work.",
    ],
    write_policy: "read_only",
    grounding_required: true,
  },
};

function realign(inputPath, outputPath) {
  const lines = readFileSync(inputPath, "utf-8").trim().split("\n");
  let mapped = 0;
  let unmapped = 0;

  const output = lines.map((line) => {
    const obj = JSON.parse(line);
    const key = `${obj.expected_intent}|${obj.expected_action}`;
    const aligned = MAPPING[key];

    if (aligned) {
      obj.db_aligned = aligned;
      mapped++;
    } else {
      // Fallback: if intent alone matches a pattern, use it
      const intentOnly = Object.keys(MAPPING).find((k) => k.startsWith(obj.expected_intent + "|"));
      if (intentOnly) {
        obj.db_aligned = MAPPING[intentOnly];
        mapped++;
      } else {
        // Unknown — mark as coaching fallback
        obj.db_aligned = {
          expected_jtbd: "coaching",
          expected_domain: "none",
          expected_tool: "none",
          expected_card_type: "none",
          canonical_sources: [],
          source_rules: ["Unmapped intent — defaulted to coaching."],
          write_policy: "read_only",
          grounding_required: false,
        };
        unmapped++;
      }
    }

    return JSON.stringify(obj);
  });

  writeFileSync(outputPath, output.join("\n") + "\n");
  console.log(`${inputPath}: ${mapped} mapped, ${unmapped} unmapped, ${lines.length} total`);
}

realign(
  "/Users/amir/Downloads/labeled_expected_behavior_dataset_db_aligned (1).jsonl",
  "/Users/amir/strongai/data/training_dataset.jsonl",
);

realign(
  "/Users/amir/Downloads/strongai_expected_vs_actual_regression.jsonl",
  "/Users/amir/strongai/data/regression_dataset.jsonl",
);
