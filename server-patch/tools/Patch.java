import org.objectweb.asm.*;
import java.io.*;
import java.util.*;
import java.util.zip.*;

/**
 * Patches meds_and_herbs so the mod can no longer apply/remove mob effects
 * or change attribute base values on its own.
 *
 * Each patched call is replaced in-place with an instruction sequence of the
 * SAME byte length (3 bytes), so branch offsets and StackMapTable frames stay
 * valid and no frame recomputation / class hierarchy is needed.
 *
 *   LivingEntity.addEffect(MobEffectInstance)Z    -> POP2; ICONST_0; NOP   (consume 2 refs, push false)
 *   LivingEntity.removeEffect(MobEffect)Z         -> POP2; ICONST_0; NOP   (consume 2 refs, push false)
 *   AttributeInstance.setBaseValue(D)V            -> POP2; POP; NOP       (consume double + ref)
 */
public class Patch {
    static final String OWNER_LIVING = "net/minecraft/world/entity/LivingEntity";
    static final String OWNER_ATTR = "net/minecraft/world/entity/ai/attributes/AttributeInstance";
    static final String ADD_EFFECT = "m_7292_";
    static final String REMOVE_EFFECT = "m_21195_";
    static final String SET_BASE = "m_22100_";
    static final String DESC_ADD = "(Lnet/minecraft/world/effect/MobEffectInstance;)Z";
    static final String DESC_REMOVE = "(Lnet/minecraft/world/effect/MobEffect;)Z";
    static final String DESC_BASE = "(D)V";

    static int addCount, removeCount, baseCount;

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("usage: Patch <input.jar> <output.jar>");
            System.exit(2);
        }
        File in = new File(args[0]);
        File out = new File(args[1]);

        try (ZipFile zf = new ZipFile(in);
             ZipOutputStream zos = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(out)))) {
            Enumeration<? extends ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                ZipEntry ne = new ZipEntry(e.getName());
                ne.setTime(e.getTime());
                if (e.getExtra() != null) ne.setExtra(e.getExtra());
                if (e.getComment() != null) ne.setComment(e.getComment());
                zos.putNextEntry(ne);
                byte[] data;
                try (InputStream is = zf.getInputStream(e)) {
                    data = is.readAllBytes();
                }
                if (e.getName().endsWith(".class")) {
                    data = patchClass(data);
                }
                zos.write(data);
                zos.closeEntry();
            }
        }
        System.out.println("Patched calls: addEffect=" + addCount
                + " removeEffect=" + removeCount
                + " setBaseValue=" + baseCount
                + " total=" + (addCount + removeCount + baseCount));
    }

    static byte[] patchClass(byte[] data) {
        ClassReader cr = new ClassReader(data);
        ClassWriter cw = new ClassWriter(0);
        ClassVisitor cv = new ClassVisitor(Opcodes.ASM9, cw) {
            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor,
                                             String signature, String[] exceptions) {
                MethodVisitor mv = super.visitMethod(access, name, descriptor, signature, exceptions);
                return new MethodVisitor(Opcodes.ASM9, mv) {
                    @Override
                    public void visitMethodInsn(int opcode, String owner, String name,
                                                String descriptor, boolean isInterface) {
                        if (opcode == Opcodes.INVOKEVIRTUAL && OWNER_LIVING.equals(owner)
                                && ADD_EFFECT.equals(name) && DESC_ADD.equals(descriptor)) {
                            // net stack effect of addEffect: -2 refs, +1 int
                            super.visitInsn(Opcodes.POP2);
                            super.visitInsn(Opcodes.ICONST_0);
                            super.visitInsn(Opcodes.NOP);
                            addCount++;
                            return;
                        }
                        if (opcode == Opcodes.INVOKEVIRTUAL && OWNER_LIVING.equals(owner)
                                && REMOVE_EFFECT.equals(name) && DESC_REMOVE.equals(descriptor)) {
                            // net stack effect of removeEffect: -2 refs, +1 int
                            super.visitInsn(Opcodes.POP2);
                            super.visitInsn(Opcodes.ICONST_0);
                            super.visitInsn(Opcodes.NOP);
                            removeCount++;
                            return;
                        }
                        if (opcode == Opcodes.INVOKEVIRTUAL && OWNER_ATTR.equals(owner)
                                && SET_BASE.equals(name) && DESC_BASE.equals(descriptor)) {
                            // net stack effect of setBaseValue: -1 ref, -1 double, +0
                            super.visitInsn(Opcodes.POP2);
                            super.visitInsn(Opcodes.POP);
                            super.visitInsn(Opcodes.NOP);
                            baseCount++;
                            return;
                        }
                        super.visitMethodInsn(opcode, owner, name, descriptor, isInterface);
                    }
                };
            }
        };
        cr.accept(cv, 0);
        return cw.toByteArray();
    }
}
