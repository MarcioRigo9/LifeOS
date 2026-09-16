#!/usr/bin/env python3
"""
Provisiona a rede (VCN, Internet Gateway, Security List, Subnet pública) e a instância Compute
(Ampere A1 Flex, Always Free) do LifeOS na OCI.

Nenhum segredo aqui — lê tudo de variáveis de ambiente (com defaults sensatos) e do perfil
`~/.oci/config` já configurado. Best-effort idempotente: verifica se cada recurso já existe
(por display_name) antes de criar, então rodar de novo depois de uma falha parcial não duplica
tudo — mas não é uma reconciliação completa (não corrige drift em recursos já existentes).

Variáveis de ambiente aceitas:
  OCI_COMPARTMENT_ID     (default: a tenancy root do perfil configurado)
  SSH_PUBLIC_KEY_PATH    (default: ~/.ssh/lifeos_vps.pub)
  VM_DISPLAY_NAME        (default: lifeos-vps)
  VM_SHAPE                (default: VM.Standard.A1.Flex; alternativa Always Free: VM.Standard.E2.1.Micro)
  VM_OCPUS / VM_MEMORY_GB (só usados quando VM_SHAPE termina em .Flex; default: 2 / 12)

Uso: uvx --with oci python deploy/provision-oci.py
"""
import os
import sys
import oci


def main():
    config = oci.config.from_file()
    compartment_id = os.environ.get("OCI_COMPARTMENT_ID", config["tenancy"])
    ssh_key_path = os.environ.get("SSH_PUBLIC_KEY_PATH", os.path.expanduser("~/.ssh/lifeos_vps.pub"))
    display_name = os.environ.get("VM_DISPLAY_NAME", "lifeos-vps")
    shape = os.environ.get("VM_SHAPE", "VM.Standard.A1.Flex")
    is_flex_shape = shape.endswith(".Flex")

    with open(ssh_key_path) as f:
        ssh_public_key = f.read().strip()

    identity = oci.identity.IdentityClient(config)
    network = oci.core.VirtualNetworkClient(config)
    compute = oci.core.ComputeClient(config)

    region = config["region"]
    print(f"Região: {region}")
    print(f"Compartment: {compartment_id}")

    ads = identity.list_availability_domains(compartment_id).data
    ad = ads[0].name
    print(f"Availability Domain: {ad}")

    # --- VCN ---
    vcn_name = f"{display_name}-vcn"
    existing_vcns = [v for v in network.list_vcns(compartment_id, display_name=vcn_name).data if v.lifecycle_state != "TERMINATED"]
    if existing_vcns:
        vcn = existing_vcns[0]
        print(f"VCN já existe: {vcn.id}")
    else:
        vcn = network.create_vcn(oci.core.models.CreateVcnDetails(
            compartment_id=compartment_id, cidr_block="10.0.0.0/16", display_name=vcn_name,
        )).data
        vcn = oci.wait_until(network, network.get_vcn(vcn.id), "lifecycle_state", "AVAILABLE").data
        print(f"VCN criada: {vcn.id}")

    # --- Internet Gateway ---
    igs = [g for g in network.list_internet_gateways(compartment_id, vcn_id=vcn.id).data if g.lifecycle_state != "TERMINATED"]
    if igs:
        ig = igs[0]
        print(f"Internet Gateway já existe: {ig.id}")
    else:
        ig = network.create_internet_gateway(oci.core.models.CreateInternetGatewayDetails(
            compartment_id=compartment_id, vcn_id=vcn.id, is_enabled=True, display_name=f"{display_name}-ig",
        )).data
        ig = oci.wait_until(network, network.get_internet_gateway(ig.id), "lifecycle_state", "AVAILABLE").data
        print(f"Internet Gateway criado: {ig.id}")

    # --- Route Table (default): 0.0.0.0/0 -> Internet Gateway ---
    route_tables = network.list_route_tables(compartment_id, vcn_id=vcn.id).data
    default_rt = next(rt for rt in route_tables if rt.id == vcn.default_route_table_id)
    network.update_route_table(default_rt.id, oci.core.models.UpdateRouteTableDetails(
        route_rules=[oci.core.models.RouteRule(
            destination="0.0.0.0/0", destination_type="CIDR_BLOCK", network_entity_id=ig.id,
        )]
    ))
    print("Route table atualizada (0.0.0.0/0 -> Internet Gateway)")

    # --- Security List (default): ingress 22/80/443, egress liberado ---
    sec_lists = network.list_security_lists(compartment_id, vcn_id=vcn.id).data
    default_sl = next(sl for sl in sec_lists if sl.id == vcn.default_security_list_id)
    port_rule = lambda port, desc: oci.core.models.IngressSecurityRule(
        protocol="6", source="0.0.0.0/0", source_type="CIDR_BLOCK", description=desc,
        tcp_options=oci.core.models.TcpOptions(destination_port_range=oci.core.models.PortRange(min=port, max=port)),
    )
    network.update_security_list(default_sl.id, oci.core.models.UpdateSecurityListDetails(
        ingress_security_rules=[port_rule(22, "SSH"), port_rule(80, "HTTP"), port_rule(443, "HTTPS")],
        egress_security_rules=[oci.core.models.EgressSecurityRule(protocol="all", destination="0.0.0.0/0", destination_type="CIDR_BLOCK")],
    ))
    print("Security list atualizada (ingress 22/80/443, egress liberado)")

    # --- Subnet pública ---
    subnet_name = f"{display_name}-subnet"
    existing_subnets = [s for s in network.list_subnets(compartment_id, vcn_id=vcn.id, display_name=subnet_name).data if s.lifecycle_state != "TERMINATED"]
    if existing_subnets:
        subnet = existing_subnets[0]
        print(f"Subnet já existe: {subnet.id}")
    else:
        subnet = network.create_subnet(oci.core.models.CreateSubnetDetails(
            compartment_id=compartment_id, vcn_id=vcn.id, cidr_block="10.0.1.0/24",
            display_name=subnet_name, prohibit_public_ip_on_vnic=False,
        )).data
        subnet = oci.wait_until(network, network.get_subnet(subnet.id), "lifecycle_state", "AVAILABLE").data
        print(f"Subnet criada: {subnet.id}")

    # --- Imagem Ubuntu (compatível com o shape escolhido) ---
    images = compute.list_images(
        compartment_id, operating_system="Canonical Ubuntu", shape=shape,
        sort_by="TIMECREATED", sort_order="DESC",
    ).data
    ubuntu_images = [i for i in images if ("22.04" in i.display_name or "24.04" in i.display_name) and "Minimal" not in i.display_name]
    if not ubuntu_images:
        ubuntu_images = [i for i in images if "22.04" in i.display_name or "24.04" in i.display_name]
    if not ubuntu_images:
        print(f"Nenhuma imagem Ubuntu 22.04/24.04 compatível com {shape} encontrada!", file=sys.stderr)
        sys.exit(1)
    image = ubuntu_images[0]
    print(f"Imagem: {image.display_name} ({image.id})")

    # --- Instância ---
    existing_instances = [
        i for i in compute.list_instances(compartment_id, display_name=display_name).data
        if i.lifecycle_state not in ("TERMINATED", "TERMINATING")
    ]
    if existing_instances:
        instance = existing_instances[0]
        print(f"Instância já existe: {instance.id} ({instance.lifecycle_state})")
    else:
        launch_kwargs = dict(
            compartment_id=compartment_id,
            availability_domain=ad,
            shape=shape,
            display_name=display_name,
            create_vnic_details=oci.core.models.CreateVnicDetails(subnet_id=subnet.id, assign_public_ip=True),
            source_details=oci.core.models.InstanceSourceViaImageDetails(image_id=image.id),
            metadata={"ssh_authorized_keys": ssh_public_key},
        )
        if is_flex_shape:
            ocpus = int(os.environ.get("VM_OCPUS", "2"))
            memory_gb = int(os.environ.get("VM_MEMORY_GB", "12"))
            launch_kwargs["shape_config"] = oci.core.models.LaunchInstanceShapeConfigDetails(ocpus=ocpus, memory_in_gbs=memory_gb)
        instance = compute.launch_instance(oci.core.models.LaunchInstanceDetails(**launch_kwargs)).data
        print(f"Lançando instância {instance.id} (shape={shape}) ... aguardando RUNNING (pode levar alguns minutos)")
        instance = oci.wait_until(compute, compute.get_instance(instance.id), "lifecycle_state", "RUNNING", max_wait_seconds=900).data

    vnic_attachments = compute.list_vnic_attachments(compartment_id, instance_id=instance.id).data
    vnic = network.get_vnic(vnic_attachments[0].vnic_id).data

    print("---")
    print(f"Estado da instância: {instance.lifecycle_state}")
    print(f"IP público: {vnic.public_ip}")
    print(f"Instance OCID: {instance.id}")


if __name__ == "__main__":
    main()
