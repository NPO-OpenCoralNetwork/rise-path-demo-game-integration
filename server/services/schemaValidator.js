// Lightweight JSON Schema validator for generation_kit responses.
// Validates required fields, types, and nested structure without external dependencies.
// Based on personalized_generation_kit.schema.json

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

const checkType = (value, expected) => {
    if (expected === 'string') return typeof value === 'string';
    if (expected === 'integer') return Number.isInteger(value);
    if (expected === 'number') return typeof value === 'number';
    if (expected === 'boolean') return typeof value === 'boolean';
    if (expected === 'array') return Array.isArray(value);
    if (expected === 'object') return asObject(value) !== null;
    return true;
};

const checkRequired = (obj, requiredFields, path) => {
    const errors = [];
    for (const field of requiredFields) {
        if (obj[field] === undefined || obj[field] === null) {
            errors.push(`${path}.${field} is required`);
        }
    }
    return errors;
};

/**
 * Validate a generation_kit response against the schema.
 * Returns { valid: boolean, errors: string[], warnings: string[] }
 */
export const validateGenerationKit = (kit) => {
    const errors = [];
    const warnings = [];
    const obj = asObject(kit);

    if (!obj) {
        return { valid: false, errors: ['generation_kit must be an object'], warnings: [] };
    }

    // Top-level required fields
    const topRequired = [
        'portal_id', 'template_id', 'locale', 'schema_version', 'policy_version',
        'required_slots', 'optional_slots', 'question_order',
        'constraints', 'output_schema', 'content_blueprint', 'save_defaults',
        'personalization'
    ];
    errors.push(...checkRequired(obj, topRequired, 'kit'));

    // Type checks for top-level
    const topStringFields = ['portal_id', 'template_id', 'locale', 'schema_version', 'policy_version'];
    for (const field of topStringFields) {
        if (obj[field] !== undefined && !checkType(obj[field], 'string')) {
            errors.push(`kit.${field} must be a string`);
        }
        if (typeof obj[field] === 'string' && obj[field].length === 0) {
            errors.push(`kit.${field} must not be empty`);
        }
    }

    const topArrayFields = ['required_slots', 'optional_slots', 'question_order'];
    for (const field of topArrayFields) {
        if (obj[field] !== undefined && !checkType(obj[field], 'array')) {
            errors.push(`kit.${field} must be an array`);
        }
    }

    // constraints
    const constraints = asObject(obj.constraints);
    if (obj.constraints !== undefined && !constraints) {
        errors.push('kit.constraints must be an object');
    }

    // output_schema
    const outputSchema = asObject(obj.output_schema);
    if (obj.output_schema !== undefined && !outputSchema) {
        errors.push('kit.output_schema must be an object');
    } else if (outputSchema) {
        errors.push(...checkRequired(outputSchema, ['type', 'required', 'module_required', 'lesson_required'], 'kit.output_schema'));
    }

    // content_blueprint
    const blueprint = asObject(obj.content_blueprint);
    if (obj.content_blueprint !== undefined && !blueprint) {
        errors.push('kit.content_blueprint must be an object');
    } else if (blueprint) {
        errors.push(...checkRequired(blueprint, ['ui_template_id'], 'kit.content_blueprint'));
    }

    // save_defaults
    const saveDefaults = asObject(obj.save_defaults);
    if (obj.save_defaults !== undefined && !saveDefaults) {
        errors.push('kit.save_defaults must be an object');
    } else if (saveDefaults) {
        errors.push(...checkRequired(saveDefaults, ['status', 'is_public', 'ui_template_id'], 'kit.save_defaults'));
    }

    // personalization (deep validation)
    const personalization = asObject(obj.personalization);
    if (obj.personalization !== undefined && !personalization) {
        errors.push('kit.personalization must be an object');
    } else if (personalization) {
        const pRequired = [
            'supported_diagnosis', 'raw_profile_schema', 'derived_profile_schema',
            'personalization_axes', 'adaptation_rules', 'quality_rubric'
        ];
        errors.push(...checkRequired(personalization, pRequired, 'kit.personalization'));

        // personalization_axes — check all 9 axes
        const axes = asObject(personalization.personalization_axes);
        if (axes) {
            const requiredAxes = [
                'credential_orientation', 'problem_solving_orientation',
                'example_first_preference', 'structure_need', 'reassurance_need',
                'practice_intensity', 'pace_preference', 'social_learning_preference',
                'feedback_style'
            ];
            errors.push(...checkRequired(axes, requiredAxes, 'kit.personalization.personalization_axes'));

            for (const axisName of requiredAxes) {
                const axis = asObject(axes[axisName]);
                if (axis) {
                    if (!axis.type) errors.push(`kit.personalization.personalization_axes.${axisName}.type is required`);
                    if (!axis.description) errors.push(`kit.personalization.personalization_axes.${axisName}.description is required`);
                }
            }
        }

        // quality_rubric
        const rubric = asObject(personalization.quality_rubric);
        if (rubric) {
            const rubricRequired = [
                'lesson_min_sections', 'lesson_required_blocks',
                'lesson_min_explanation_chars', 'lesson_min_practice_items',
                'require_cautions'
            ];
            errors.push(...checkRequired(rubric, rubricRequired, 'kit.personalization.quality_rubric'));
        }

        // adaptation_rules — check structure
        if (personalization.adaptation_rules !== undefined) {
            if (!Array.isArray(personalization.adaptation_rules)) {
                errors.push('kit.personalization.adaptation_rules must be an array');
            } else {
                for (let i = 0; i < personalization.adaptation_rules.length; i++) {
                    const rule = asObject(personalization.adaptation_rules[i]);
                    if (!rule) {
                        errors.push(`kit.personalization.adaptation_rules[${i}] must be an object`);
                    } else {
                        if (!rule.axis) errors.push(`kit.personalization.adaptation_rules[${i}].axis is required`);
                        if (!rule.when) errors.push(`kit.personalization.adaptation_rules[${i}].when is required`);
                        if (!Array.isArray(rule.adapts)) errors.push(`kit.personalization.adaptation_rules[${i}].adapts must be an array`);
                    }
                }
            }
        }

        // Warnings for optional enrichment fields
        if (!personalization.derived_learning_profile) {
            warnings.push('kit.personalization.derived_learning_profile is missing (no learner profile attached)');
        }
        if (!personalization.generation_rules) {
            warnings.push('kit.personalization.generation_rules is missing (no generation rules derived)');
        }
    }

    return { valid: errors.length === 0, errors, warnings };
};
